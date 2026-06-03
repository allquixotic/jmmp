// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export interface SelectionModifiers {
  range?: boolean;
  additive?: boolean;
}

export interface SelectionResult {
  selectedIds: number[];
  anchorId: number | null;
}

export function updateTrackSelection(
  orderedIds: number[],
  currentSelection: number[],
  anchorId: number | null,
  clickedId: number,
  modifiers: SelectionModifiers = {}
): SelectionResult {
  if (!orderedIds.includes(clickedId)) {
    return { selectedIds: currentSelection, anchorId };
  }

  if (modifiers.range && anchorId !== null && orderedIds.includes(anchorId)) {
    const start = orderedIds.indexOf(anchorId);
    const end = orderedIds.indexOf(clickedId);
    const range = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    if (!modifiers.additive) {
      return { selectedIds: range, anchorId };
    }
    const selected = new Set([...currentSelection, ...range]);
    return {
      selectedIds: orderedIds.filter((id) => selected.has(id)),
      anchorId,
    };
  }

  if (modifiers.additive) {
    const selected = new Set(currentSelection);
    if (selected.has(clickedId)) selected.delete(clickedId);
    else selected.add(clickedId);
    return {
      selectedIds: orderedIds.filter((id) => selected.has(id)),
      anchorId: clickedId,
    };
  }

  return { selectedIds: [clickedId], anchorId: clickedId };
}

export function trackActionIds(
  selectedIds: number[],
  clickedId: number
): number[] {
  return selectedIds.includes(clickedId) && selectedIds.length > 0
    ? selectedIds
    : [clickedId];
}
