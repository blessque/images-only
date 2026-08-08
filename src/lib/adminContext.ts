import { createContext, useContext, type ReactNode } from 'react';
import type { ImageItem, Settings } from './types';

/**
 * The seam between the public grid and the admin layer.
 *
 * Lives in the MAIN chunk on purpose — but it holds only a context and a type, no admin
 * code. `Grid`/`Tile` therefore never import from `src/admin/`, which is what keeps the
 * admin bundle behind a dynamic import and out of a normal visitor's download.
 *
 * See .claude/rules/architecture.md.
 */
export interface AdminHooks {
  /** Rendered inside each tile when admin is active. Absent for every public visitor. */
  renderTileOverlay?: (item: ImageItem, index: number) => ReactNode;
  /** Present only in admin mode; turns the footer's text into editable fields. */
  editSettings?: (patch: Partial<Settings>) => void;
  /** Lets the grid surface admin-only advice, e.g. a final row that solved absurdly tall. */
  adminActive?: boolean;
}

export const AdminContext = createContext<AdminHooks>({});

export function useAdminHooks(): AdminHooks {
  return useContext(AdminContext);
}
