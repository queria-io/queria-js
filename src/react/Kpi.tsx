import { type KpiOptions, renderKpi } from "../render/kpi.js";
import { type Data, Frame, useDraw, useResult } from "./result.js";

type Props = { className?: string } & KpiOptions & Data;

/** One number of the SQL result (or of `rows`) shown large with its change, followed by the sources. */
export const Kpi = ({ className = "queria-kpi", value, compare, label, unit, compareLabel, compact, ...data }: Props) => {
  const result = useResult(data);
  // A change of the options redraws without running the SQL again.
  const [ref, error] = useDraw(result.values, (el, rows) => renderKpi(el, rows, { value, compare, label, unit, compareLabel, compact }), [
    value,
    compare,
    label,
    unit,
    compareLabel,
    compact,
  ]);
  return <Frame className={className} result={result} error={error}><div ref={ref} /></Frame>;
};
