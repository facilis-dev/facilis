import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
};

export type TabsProps = {
  tabs: readonly TabItem[];
  label: string;
  initialId?: string;
};

/** Roving-tabindex tabs: arrows/Home/End move selection, the active tab owns the tab stop. */
export function Tabs({ tabs, label, initialId }: TabsProps) {
  const base = useId();
  const [activeId, setActiveId] = useState(initialId ?? tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next = index;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    setActiveId(target.id);
    const list = event.currentTarget.parentElement;
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  if (active === undefined) return null;

  return (
    <div className="lab-tabs">
      <div className="lab-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={base + tab.id}
              aria-selected={selected}
              aria-controls={base + tab.id + "-panel"}
              tabIndex={selected ? 0 : -1}
              className="lab-tab"
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className="lab-tabs__panel"
        role="tabpanel"
        id={base + active.id + "-panel"}
        aria-labelledby={base + active.id}
        tabIndex={0}
      >
        {active.content}
      </div>
    </div>
  );
}
