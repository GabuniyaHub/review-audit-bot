"""Bounded live probe of public Yandex card HTML. No browser or CAPTCHA bypass.
Run: SSL_CERT_FILE=/etc/ssl/cert.pem python3 tools/probe_yandex.py --output results.json
Only aggregate diagnostics are saved; review texts and authors are not exported.
"""
import argparse
import json
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

CARDS = [
    ('Garden', 'garden_coffee', '35702680521', 'Малыгина'),
    ('Кофе Брют', 'kofe_bryut', '130058052929', 'Советская'),
    ('Optimist coffee', 'optimist_coffee', '130207180834', 'Республики, 58'),
    ('Максим (кандидат)', 'maxim', '1085996169', 'Республики, 24'),
]

class StateParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []
        self.states = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('type') == 'application/json' and attrs.get('class') == 'state-view':
            self.active = True
            self.parts = []

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.active:
            self.states.append(json.loads(''.join(self.parts)))
            self.active = False


def find_card(value, org_id):
    if isinstance(value, dict):
        if str(value.get('id')) == org_id and 'reviewResults' in value:
            return value
        for child in value.values():
            found = find_card(child, org_id)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_card(child, org_id)
            if found is not None:
                return found
    return None


def probe():
    results = []
    for name, slug, org_id, expected in CARDS:
        result = {'name': name, 'org_id': org_id, 'expected_address_fragment': expected, 'pages': []}
        seen = set()
        start = time.monotonic()
        for page in (1, 2, 3):
            url = f'https://yandex.ru/maps/org/{slug}/{org_id}/reviews/?page={page}'
            row = {'page': page}
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'review-audit-bot-research/0.1'})
                with urllib.request.urlopen(request, timeout=25) as response:
                    row['http_status'] = response.status
                    final_url = response.url
                    html = response.read().decode('utf-8')
                if 'showcaptcha' in final_url or '<title>Ой!' in html or '<title>Are you not a robot?' in html:
                    row['status'] = 'captcha'
                    result['pages'].append(row)
                    break
                parser = StateParser()
                parser.feed(html)
                card = next((c for state in parser.states if (c := find_card(state, org_id)) is not None), None)
                if card is None:
                    row['status'] = 'layout_changed_or_no_review_state'
                    result['pages'].append(row)
                    break
                result['actual_title'] = card.get('title')
                result['actual_address'] = card.get('address')
                result['address_fragment_matches'] = expected.casefold() in card.get('address', '').casefold()
                reviews = card['reviewResults'].get('reviews', [])
                ids = {r['reviewId'] for r in reviews if r.get('reviewId') and r.get('text', '').strip()}
                row.update(status='ok', received=len(reviews), unique_text_ids=len(ids), new_ids=len(ids-seen), with_rating=sum(r.get('rating') is not None for r in reviews), with_updated_time=sum(bool(r.get('updatedTime')) for r in reviews))
                seen.update(ids)
                result['pages'].append(row)
                if not result['address_fragment_matches'] or row['new_ids'] == 0:
                    break
            except (urllib.error.URLError, TimeoutError, ValueError) as error:
                row.update(status='error', error_type=type(error).__name__)
                result['pages'].append(row)
                break
            time.sleep(1)
        result.update(unique_text_reviews=len(seen), elapsed_seconds=round(time.monotonic()-start, 2))
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return results

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--output', required=True)
    path = Path(args.parse_args().output)
    path.write_text(json.dumps(probe(), ensure_ascii=False, indent=2)+'\n')
