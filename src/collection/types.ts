export type Source='2gis'|'yandex';
export type CollectionErrorCode='captcha'|'rate_limited'|'forbidden'|'timeout'|'layout_changed'|'unavailable'|'invalid_data'|'not_configured';
export class CollectionError extends Error {
  constructor(readonly code:CollectionErrorCode,readonly retryAfter=0) {super('Review source collection failed');}
}
export interface ReviewInput {
  externalId?:string; excluded?:boolean; text:unknown; rating?:unknown; publishedAt?:unknown;
  updatedAtSource?:unknown; rawDate?:unknown; sourceUrl?:unknown; authorKey?:unknown;
}
export interface NormalizedReview {
  externalId:string|null;dedupKey:string;text:string;rating:number|null;
  publishedAt:string|null;updatedAtSource:string|null;rawDate:string|null;
  sourceUrl:string|null;contentHash:string;textFingerprint:string;
}
export interface SourceTarget {source:Source;externalId:string;url:string;maxReviews?:number}
export interface ReviewPage {reviews:NormalizedReview[];invalidCount:number;page:number;stopReason:'exhausted'|'limit'|null}
export interface ReviewCollector {pages(target:SourceTarget,signal?:AbortSignal):AsyncIterable<ReviewPage>}
export const REVIEW_COLLECTOR=Symbol('REVIEW_COLLECTOR');
