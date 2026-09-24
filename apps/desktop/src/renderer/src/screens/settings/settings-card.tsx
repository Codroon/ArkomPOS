/**
 * One subject, one card — the shape Ajustes has used since v0.17.0.
 *
 * Lifted out of the screen when the cloud panel arrived: two files drawing the
 * same box by copy is how two boxes stop looking alike.
 */
import type { ReactNode } from "react";
import { SectionLabel } from "@arkom/ui";

export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[3px] border border-line bg-card px-3.5 py-3">
      <SectionLabel>{title}</SectionLabel>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
