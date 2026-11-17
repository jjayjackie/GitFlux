// The diff's overview ruler, as VS Code's diff editor draws it beside the diff (overviewRulerFeature.ts): the whole file
// in a strip, the lines removed marked in its left half and those added in its right, and the part in view as a
// scrollbar's slider over them.
//
// `slider` is adapted from ScrollbarState in VS Code 1.142.0's src/vs/base/browser/ui/scrollbar/scrollbarState.ts, and
// `zone` from OverviewZoneManager.resolveColorZones in its src/vs/editor/common/viewModel/overviewZoneManager.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

export const WIDTH = 30; // OverviewRulerFeature.ENTIRE_DIFF_OVERVIEW_WIDTH, two halves of 15

const MINIMUM_SLIDER = 20; // the slider stays this tall to be grabbed
const MINIMUM_ZONE = 4; // a mark stays this tall to be seen

/** Where the part in view sits on a ruler as tall as the view: the slider's top and size, and pixels of ruler per pixel scrolled. */
export function slider(view: number, content: number, scrolled: number) {
  if (!(content > view)) return { top: 0, size: Math.round(view), ratio: 0 };
  const size = Math.round(Math.max(MINIMUM_SLIDER, Math.floor((view * view) / content)));
  const ratio = (view - size) / (content - view);
  return { top: Math.round(scrolled * ratio), size, ratio };
}

/** A mark on a ruler `height` tall for what lies from `start` to `end` down `content`: at least four pixels, kept on the ruler. */
export function zone(start: number, end: number, content: number, height: number) {
  const ratio = height / content;
  const [y1, y2] = [Math.floor(ratio * start), Math.floor(ratio * end)];
  const half = Math.max(y2 - Math.floor((y1 + y2) / 2), MINIMUM_ZONE / 2);
  const centre = Math.min(Math.max(Math.floor((y1 + y2) / 2), half), height - half);
  return { top: centre - half, height: half * 2 };
}

/** Rows [from, to). */
export type Span = [number, number];

/**
 * The rows of each change that hold its removed lines and those that hold its added ones, as two lists of spans.
 * `removed` and `added` say whether a row holds a line of each kind; a change with none of a kind has no span of it.
 */
export function changeSpans<Row>(rows: Row[], removed: (row: Row) => boolean, added: (row: Row) => boolean) {
  const spans = { removed: [] as Span[], added: [] as Span[] };
  const extend = (list: Span[], index: number) => {
    const last = list[list.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else list.push([index, index + 1]);
  };
  rows.forEach((row, index) => {
    if (removed(row)) extend(spans.removed, index);
    if (added(row)) extend(spans.added, index);
  });
  return spans;
}
