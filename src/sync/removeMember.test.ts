import { describe, expect, it } from 'vitest';
import { parseRemovedMember } from './remote';

describe('lo que devuelve remove_member', () => {
  it('lee el objeto de la base (proyectos que pasaron y los que quedaron sin heredero)', () => {
    expect(
      parseRemovedMember({ transferred: [{ project_id: 'a', to: 'b' }], without_heir: ['c', 'd'] }),
    ).toEqual({ transferred: 1, withoutHeir: 2 });
  });

  it('acepta el número de antes y respuestas raras sin romperse', () => {
    expect(parseRemovedMember(3)).toEqual({ transferred: 3, withoutHeir: 0 });
    expect(parseRemovedMember(null)).toEqual({ transferred: 0, withoutHeir: 0 });
    expect(parseRemovedMember({ transferred: 'x' })).toEqual({ transferred: 0, withoutHeir: 0 });
  });
});
