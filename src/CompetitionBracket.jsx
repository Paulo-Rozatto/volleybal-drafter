import React, { useEffect, useMemo, useRef, useState } from 'react';
import CompetitionMatchCard from './CompetitionMatchCard.jsx';
import {
  buildCompetitionBracketModel,
  competitionChampionView,
} from './competitionPresentation.js';

const COLUMN_MIN_WIDTH = 220;

function readSlotBox(element, root) {
  if (!element || !root) return null;
  const rootBox = root.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return {
    left: box.left - rootBox.left + root.scrollLeft,
    right: box.right - rootBox.left + root.scrollLeft,
    cy: box.top - rootBox.top + root.scrollTop + box.height / 2,
  };
}

function connectorPaths(columns, positions) {
  const paths = [];
  for (const column of columns) {
    for (const slot of column.slots) {
      const parent = positions.get(slot.id);
      if (!parent) continue;
      for (const childId of [slot.leftId, slot.rightId]) {
        if (!childId) continue;
        const child = positions.get(childId);
        if (!child) continue;
        const midX = (child.right + parent.left) / 2;
        paths.push(`M ${child.right} ${child.cy} H ${midX} V ${parent.cy} H ${parent.left}`);
      }
    }
  }
  return paths;
}

function BracketStrip({ columns, onOpenMatch, paths, canvasSize, canvasRef, columnRefs, tabAriaLabel }) {
  return (
    <div className="space-y-3">
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Deslize para o lado para ver a chave completa.
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={tabAriaLabel}>
        {columns.map((column, index) => (
          <button
            key={`phase-${column.index}-${column.name}`}
            type="button"
            role="tab"
            onClick={() =>
              columnRefs.current[index]?.scrollIntoView({
                behavior: 'smooth',
                inline: 'center',
                block: 'nearest',
              })
            }
            className="shrink-0 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            {column.name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div
          ref={canvasRef}
          className="relative inline-flex gap-10 min-h-[16rem] py-2"
          style={{ minWidth: '100%' }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={canvasSize.width}
            height={canvasSize.height}
            style={{ overflow: 'visible' }}
          >
            {paths.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="var(--border-color)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>

          {columns.map((column, index) => (
            <section
              key={`${column.index}-${column.name}`}
              ref={(node) => {
                columnRefs.current[index] = node;
              }}
              aria-label={column.name}
              className="relative z-10 flex flex-col"
              style={{ minWidth: COLUMN_MIN_WIDTH, width: COLUMN_MIN_WIDTH }}
            >
              <h3
                className="text-xs font-bold uppercase tracking-wide mb-3 text-center"
                style={{ color: 'var(--text-muted)' }}
              >
                {column.name}
              </h3>
              <div className="flex-1 flex flex-col">
                {column.slots.map((slot) => (
                  <div key={slot.id} className="flex-1 flex items-center py-2">
                    <CompetitionMatchCard slot={slot} onOpen={onOpenMatch} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function useBracketPaths(columns, competition) {
  const canvasRef = useRef(null);
  const columnRefs = useRef([]);
  const [paths, setPaths] = useState([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const update = () => {
      const positions = new Map();
      for (const element of canvas.querySelectorAll('[data-slot-id]')) {
        const id = element.getAttribute('data-slot-id');
        const box = readSlotBox(element, canvas);
        if (id && box) positions.set(id, box);
      }
      setPaths(connectorPaths(columns, positions));
      setCanvasSize({
        width: Math.max(canvas.scrollWidth, canvas.clientWidth),
        height: Math.max(canvas.scrollHeight, canvas.clientHeight),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [columns, competition]);

  return { canvasRef, columnRefs, paths, canvasSize };
}

function BracketSection({ columns, competition, onOpenMatch, tabAriaLabel }) {
  const { canvasRef, columnRefs, paths, canvasSize } = useBracketPaths(columns, competition);
  return (
    <BracketStrip
      columns={columns}
      onOpenMatch={onOpenMatch}
      paths={paths}
      canvasSize={canvasSize}
      canvasRef={canvasRef}
      columnRefs={columnRefs}
      tabAriaLabel={tabAriaLabel}
    />
  );
}

export default function CompetitionBracket({
  competition,
  stage = null,
  onOpenMatch,
  showChampion = false,
}) {
  const model = useMemo(() => buildCompetitionBracketModel(competition, stage), [competition, stage]);
  const champion = useMemo(
    () => (showChampion ? competitionChampionView(competition) : null),
    [competition, showChampion]
  );

  const sections = useMemo(() => {
    const source =
      model.sections?.length > 0
        ? model.sections.map((section) => ({ ...section, columns: [...section.columns] }))
        : [{ id: 'main', name: null, columns: [...(model.columns ?? [])] }];
    if (champion && source.length > 0) {
      const last = source[source.length - 1];
      const finalSlot = last.columns.at(-1)?.slots.find((slot) => slot.type === 'match') ?? null;
      last.columns.push({
        index: last.columns.length,
        name: champion.heading,
        slots: [
          {
            type: 'champion',
            id: 'competition-champion',
            leftId: finalSlot?.id ?? null,
            rightId: null,
            playable: false,
            heading: champion.heading,
            teamLabel: champion.teamLabel,
            memberNames: champion.memberNames,
            scoreLabel: champion.scoreLabel,
          },
        ],
      });
    }
    return source;
  }, [model, champion]);

  const hasColumns = sections.some((section) => section.columns.length > 0);
  if (!hasColumns) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        A chave ainda não foi gerada.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.id} className="space-y-2">
          {section.name && (
            <h4 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>
              {section.name}
            </h4>
          )}
          <BracketSection
            columns={section.columns}
            competition={competition}
            onOpenMatch={onOpenMatch}
            tabAriaLabel={section.name ? `Fases: ${section.name}` : 'Fases da chave'}
          />
        </div>
      ))}
    </div>
  );
}
