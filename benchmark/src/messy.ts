// The deliberately messy dataset: seeded, so every run writes the same bytes
// (datasets.json records its sha256). Orders with mixed date formats, nulls,
// inconsistent category spellings, prices stored as text, and duplicate rows.

/** mulberry32: a tiny seeded PRNG, identical on every platform. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Canonical value → spellings seen in the file. */
const REGIONS: Record<string, string[]> = {
  North: ["North", "north", "NORTH", " North", "N"],
  South: ["South", "south", "SOUTH", "South ", "S"],
  East: ["East", "east", "EAST", " east ", "E"],
  West: ["West", "west", "WEST", "West ", "W"],
};

const CATEGORIES: Record<string, { spellings: string[]; prices: number[] }> = {
  Electronics: {
    spellings: ["Electronics", "electronics", "ELECTRONICS"],
    prices: [19.99, 49.5, 129, 299.99, 1299],
  },
  "Home & Garden": {
    spellings: ["Home & Garden", "Home and Garden", "home & garden"],
    prices: [8.75, 24, 59.9, 115],
  },
  Toys: {
    spellings: ["Toys", "toys", "Toys "],
    prices: [5.5, 12.99, 34, 79.95],
  },
  Books: {
    spellings: ["Books", "books", "BOOKS"],
    prices: [7.99, 15, 22.5, 45],
  },
};

const STATUSES: Record<string, string[]> = {
  shipped: ["shipped", "Shipped", "SHIPPED"],
  delivered: ["delivered", "Delivered"],
  cancelled: ["cancelled", "canceled", "Cancelled", "CANCELED"],
  returned: ["returned", "Returned"],
  pending: ["pending", "Pending"],
};

const ORDERS = 600;
const DUPLICATES = 14;
const HEADER =
  "order_id,order_date,customer_id,region,category,quantity,unit_price,status";

const pad = (n: number) => String(n).padStart(2, "0");

function price(p: number, style: number): string {
  const plain = p.toFixed(2);
  const grouped =
    p >= 1000 ? `${Math.floor(p / 1000)},${plain.slice(-6)}` : plain;
  return (
    [plain, `$${plain}`, grouped, `$${grouped}`, ` ${plain}`][style] ?? plain
  );
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** The messy CSV, byte-identical for a given seed. */
export function messyOrdersCsv(seed = 20240101): string {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const rows: string[] = [];
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < ORDERS; i++) {
    const d = new Date(start + Math.floor(r() * 182) * 86_400_000);
    const [y, m, day] = [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
    ];
    const fmt = r();
    const date =
      fmt < 0.02
        ? ""
        : fmt < 0.5
          ? `${y}-${pad(m)}-${pad(day)}`
          : fmt < 0.8
            ? `${pad(m)}/${pad(day)}/${y}`
            : `${MONTHS[m - 1]} ${day}, ${y}`;
    const region =
      r() < 0.03 ? "" : pick(REGIONS[pick(Object.keys(REGIONS))] ?? []);
    const cat = CATEGORIES[pick(Object.keys(CATEGORIES))];
    if (!cat) throw new Error("unreachable");
    const quantity = r() < 0.04 ? "" : String(1 + Math.floor(r() * 10));
    const unitPrice =
      r() < 0.03 ? "" : price(pick(cat.prices), Math.floor(r() * 5));
    const status = pick(STATUSES[pick(Object.keys(STATUSES))] ?? []);
    rows.push(
      [
        String(1001 + i),
        date,
        `C${pad(1 + Math.floor(r() * 80)).padStart(3, "0")}`,
        region,
        pick(cat.spellings),
        quantity,
        unitPrice,
        status,
      ]
        .map(csvField)
        .join(","),
    );
  }
  // Exact duplicates of earlier rows, placed at random positions.
  for (let i = 0; i < DUPLICATES; i++) {
    const src = rows[Math.floor(r() * ORDERS)] as string;
    rows.splice(Math.floor(r() * rows.length), 0, src);
  }
  return `${HEADER}\n${rows.join("\n")}\n`;
}
