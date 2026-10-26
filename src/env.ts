export const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

/** iOS Safari silently fails on canvases above ~16.7 megapixels, so keep every canvas within 4096². */
export const MAX_CANVAS_SIDE = IS_IOS ? 4096 : 8192;

/**
 * Decoded input images are kept in memory for every project page, so they are capped
 * (lower on phones/tablets) to keep multi-page projects within mobile memory limits.
 */
export const MAX_SOURCE_SIDE = IS_TOUCH ? 2048 : 4096;
