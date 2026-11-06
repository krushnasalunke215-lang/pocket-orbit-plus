import { createComponent, Types } from '@iwsdk/core';

/** Marks an entity as a body on the board. System-free declaration module. */
export const BoardBody = createComponent('BoardBody', {
  bodyId: { type: Types.String, default: '' },
  movable: { type: Types.Boolean, default: false },
});
