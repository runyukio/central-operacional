"use client";

import { type ComponentPropsWithoutRef } from "react";
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid as RechartsCartesianGrid,
  Cell as RechartsCell,
  ComposedChart as RechartsComposedChart,
  Line as RechartsLine,
  LineChart as RechartsLineChart,
  Pie as RechartsPie,
  PieChart as RechartsPieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis
} from "recharts";
import type { BarProps, PieProps } from "recharts";

export function ChartBar(props: Omit<BarProps, "ref">) {
  return <RechartsBar {...props} />;
}

export function ChartBarChart(props: ComponentPropsWithoutRef<typeof RechartsBarChart>) {
  return <RechartsBarChart {...props} />;
}

export function ChartCartesianGrid(props: ComponentPropsWithoutRef<typeof RechartsCartesianGrid>) {
  return <RechartsCartesianGrid {...props} />;
}

export function ChartCell(props: ComponentPropsWithoutRef<typeof RechartsCell>) {
  return <RechartsCell {...props} />;
}

export function ChartComposedChart(props: ComponentPropsWithoutRef<typeof RechartsComposedChart>) {
  return <RechartsComposedChart {...props} />;
}

export function ChartLine(props: ComponentPropsWithoutRef<typeof RechartsLine>) {
  return <RechartsLine {...props} />;
}

export function ChartLineChart(props: ComponentPropsWithoutRef<typeof RechartsLineChart>) {
  return <RechartsLineChart {...props} />;
}

export function ChartPie(props: Omit<PieProps, "ref">) {
  return <RechartsPie {...props} />;
}

export function ChartPieChart(props: ComponentPropsWithoutRef<typeof RechartsPieChart>) {
  return <RechartsPieChart {...props} />;
}

export function ChartResponsiveContainer(props: ComponentPropsWithoutRef<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer {...props} />;
}

export function ChartTooltip(props: ComponentPropsWithoutRef<typeof RechartsTooltip>) {
  return <RechartsTooltip {...props} />;
}

export function ChartXAxis(props: ComponentPropsWithoutRef<typeof RechartsXAxis>) {
  return <RechartsXAxis {...props} />;
}

export function ChartYAxis(props: ComponentPropsWithoutRef<typeof RechartsYAxis>) {
  return <RechartsYAxis {...props} />;
}
