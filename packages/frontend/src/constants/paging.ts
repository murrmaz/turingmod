import { MAX_DATA_PAGE_SIZE } from '@turingmod/shared';

/** The page sizes a paged data view offers, up to the most the backend returns in one page. */
export const DATA_PAGE_SIZES = [25, 50, 100, MAX_DATA_PAGE_SIZE];
