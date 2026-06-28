export const TIME_FILTER_QUERY_KEYS = ["from", "to", "timePreset", "month"] as const;
export const DASHBOARD_SCOPE_QUERY_KEYS = [
  ...TIME_FILTER_QUERY_KEYS,
  "excludePlaid",
] as const;
export const TIME_FILTER_CHANGE_EVENT = "finance-time-filter-change";

export type TimeFilterPreset = "all" | "last30" | "last90" | "ytd" | "custom";

export type TimeFilter = {
  from?: string;
  to?: string;
  month?: string;
  preset: TimeFilterPreset;
  /** When true, hide rows ingested via Plaid sync across dashboard views. */
  excludePlaid?: boolean;
};

type SearchValue = string | string[] | undefined;

export type TimeFilterSearchParams = Record<string, SearchValue>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function getSingleValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function isValidDateInput(value: string | undefined) {
  return Boolean(value && DATE_PATTERN.test(value));
}

export function isValidMonthInput(value: string | undefined) {
  return Boolean(value && MONTH_PATTERN.test(value));
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getMonthRange(
  month: string,
): Pick<TimeFilter, "from" | "to" | "month"> {
  const [yearValue, monthValue] = month.split("-").map(Number);
  const firstDay = new Date(yearValue, monthValue - 1, 1);
  const lastDay = new Date(yearValue, monthValue, 0);

  return {
    month,
    from: formatDateInput(firstDay),
    to: formatDateInput(lastDay),
  };
}

function getPreset(value: string | undefined): TimeFilterPreset {
  if (
    value === "all" ||
    value === "last30" ||
    value === "last90" ||
    value === "ytd" ||
    value === "custom"
  ) {
    return value;
  }

  return "all";
}

export function normalizeTimeFilter(
  searchParams: TimeFilterSearchParams,
): TimeFilter {
  const from = getSingleValue(searchParams.from);
  const to = getSingleValue(searchParams.to);
  const month = getSingleValue(searchParams.month);
  const hasRange = isValidDateInput(from) || isValidDateInput(to);
  const hasMonth = isValidMonthInput(month);
  const monthRange = hasMonth && !hasRange ? getMonthRange(month!) : null;
  const preset = hasRange
    ? getPreset(getSingleValue(searchParams.timePreset)) === "all"
      ? "custom"
      : getPreset(getSingleValue(searchParams.timePreset))
    : hasMonth
      ? "custom"
      : getPreset(getSingleValue(searchParams.timePreset));

  return {
    from: monthRange?.from ?? (isValidDateInput(from) ? from : undefined),
    to: monthRange?.to ?? (isValidDateInput(to) ? to : undefined),
    month: hasMonth ? month : undefined,
    preset,
    excludePlaid:
      getSingleValue(searchParams.excludePlaid) === "true" ||
      getSingleValue(searchParams.excludePlaid) === "1",
  };
}

export function buildTimeFilterQueryParams(filter: TimeFilter) {
  return {
    from: filter.from ?? "",
    to: filter.to ?? "",
    excludePlaid: Boolean(filter.excludePlaid),
  };
}

export function filterUsesTimeRange(filter: TimeFilter) {
  return Boolean(filter.from || filter.to);
}

export function timeFilterToSearchString(filter: TimeFilter) {
  const params = new URLSearchParams();

  if (filter.from) {
    params.set("from", filter.from);
  }

  if (filter.to) {
    params.set("to", filter.to);
  }

  if (filter.month) {
    params.set("month", filter.month);
  }

  if (filter.preset !== "all") {
    params.set("timePreset", filter.preset);
  }

  if (filter.excludePlaid) {
    params.set("excludePlaid", "true");
  }

  return params.toString();
}

export function copyTimeFilterParams(
  source: Pick<URLSearchParams, "get">,
  target = new URLSearchParams(),
) {
  DASHBOARD_SCOPE_QUERY_KEYS.forEach((key) => {
    const value = source.get(key);

    if (value) {
      target.set(key, value);
    }
  });

  return target;
}

export function formatTimeFilterLabel(filter: TimeFilter) {
  if (filter.month) {
    return formatMonthLabel(filter.month);
  }

  if (!filter.from && !filter.to) {
    return "All available dates";
  }

  if (filter.from && filter.to) {
    return `${filter.from} to ${filter.to}`;
  }

  if (filter.from) {
    return `From ${filter.from}`;
  }

  return `Through ${filter.to}`;
}

export function formatMonthLabel(month: string) {
  const [yearValue, monthValue] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(yearValue, monthValue - 1, 1));
}

export function filterByPostedAt<T extends { postedAt: string }>(
  rows: T[],
  filter: TimeFilter,
) {
  return rows.filter((row) => {
    if (filter.from && row.postedAt < filter.from) {
      return false;
    }

    if (filter.to && row.postedAt > filter.to) {
      return false;
    }

    return true;
  });
}

export function filterByDate<T extends { date: string }>(
  rows: T[],
  filter: TimeFilter,
) {
  return rows.filter((row) => {
    if (filter.from && row.date < filter.from) {
      return false;
    }

    if (filter.to && row.date > filter.to) {
      return false;
    }

    return true;
  });
}
