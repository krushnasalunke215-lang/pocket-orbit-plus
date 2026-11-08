import { createComponent, Types } from '@iwsdk/core';

/** Marks an entity as a body on the board. System-free declaration module. */
export const BoardBody = createComponent('BoardBody', {
  bodyId: { type: Types.String, default: '' },
  movable: { type: Types.Boolean, default: false },
});

/** A draggable well puck under the board root (Your Table fallback); `wellId` names its external well. */
export const WellPuck = createComponent('WellPuck', {
  wellId: { type: Types.String, default: '' },
});

/** The glowing marker of a real-object well (Your Table); `wellId` names its external well. */
export const WellMarker = createComponent('WellMarker', {
  wellId: { type: Types.String, default: '' },
});
