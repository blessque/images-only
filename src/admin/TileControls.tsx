import { useState } from 'react';
import { SIZE_CLASSES, type ImageItem, type SizeClass } from '@/lib/types';

interface TileControlsProps {
  item: ImageItem;
  index: number;
  total: number;
  onMove: (id: string, direction: -1 | 1) => void;
  onSizeClass: (id: string, sizeClass: SizeClass) => void;
  onAlt: (id: string, alt: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Per-image controls, drawn over the tile in admin mode.
 *
 * Arrows are BOTH clickable icons and keyboard keys, per the brief. They are the primary
 * reorder mechanism because a justified grid re-solves under a dragged item — the drop
 * target moves while you are dragging toward it — so drag-to-reorder needs an insertion
 * indicator computed against the pre-drag layout, and lands later.
 */
export function TileControls({
  item,
  index,
  total,
  onMove,
  onSizeClass,
  onAlt,
  onDelete,
}: TileControlsProps) {
  const [editingAlt, setEditingAlt] = useState(false);

  return (
    <div className="tc">
      <div className="tc-bar">
        <button
          type="button"
          className="tc-btn"
          onClick={() => onMove(item.id, -1)}
          disabled={index === 0}
          aria-label="Move earlier"
          title="Move earlier (←)"
        >
          ←
        </button>
        <button
          type="button"
          className="tc-btn"
          onClick={() => onMove(item.id, 1)}
          disabled={index === total - 1}
          aria-label="Move later"
          title="Move later (→)"
        >
          →
        </button>

        <div className="tc-classes" role="group" aria-label="Size">
          {SIZE_CLASSES.map((sizeClass: SizeClass) => (
            <button
              key={sizeClass}
              type="button"
              className={item.sizeClass === sizeClass ? 'tc-btn is-active' : 'tc-btn'}
              onClick={() => onSizeClass(item.id, sizeClass)}
              title={`Size: ${sizeClass}`}
            >
              {sizeClass.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="tc-btn"
          onClick={() => setEditingAlt((open) => !open)}
          aria-label="Alt text"
          title="Alt text"
        >
          alt
        </button>

        <button
          type="button"
          className="tc-btn tc-danger"
          onClick={() => onDelete(item.id)}
          aria-label="Delete"
          title="Delete"
        >
          ×
        </button>

        <span className="tc-index">{index + 1}</span>
      </div>

      {editingAlt ? (
        <input
          className="tc-alt"
          defaultValue={item.alt}
          placeholder="Alt text"
          autoFocus
          onBlur={(event) => {
            onAlt(item.id, event.target.value);
            setEditingAlt(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setEditingAlt(false);
          }}
        />
      ) : null}
    </div>
  );
}
