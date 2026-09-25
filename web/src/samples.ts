// Sample datasets in web/public/samples/. Sources, licenses, and the exact
// transformations are recorded in the README ("Datasets and licenses").

export interface Sample {
  id: string;
  title: string;
  file: string;
  format: string;
  rows: number;
  description: string;
  questions: [string, string];
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

export const SAMPLES: Sample[] = [
  {
    id: "penguins",
    title: "Palmer Penguins",
    file: "penguins.csv",
    format: "CSV",
    rows: 344,
    description:
      "Penguins from three islands near Palmer Station, Antarctica: species, bill and flipper size, body mass, sex.",
    questions: [
      "Which species has the heaviest average body mass?",
      "How does flipper length relate to body mass for each species?",
    ],
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://allisonhorst.github.io/palmerpenguins/",
  },
  {
    id: "bike-sharing",
    title: "Bike Sharing, hourly",
    file: "bike_sharing_hourly.parquet",
    format: "Parquet",
    rows: 17_379,
    description:
      "Hourly Capital Bikeshare rentals in Washington, D.C. for 2011–2012, with season, weather, and temperature.",
    questions: [
      "Which hour of the day has the most rentals on working days?",
      "How much did total rentals grow from 2011 to 2012?",
    ],
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset",
  },
  {
    id: "online-retail",
    title: "Online Retail, one week",
    file: "online_retail_week.xlsx",
    format: "Excel",
    rows: 16_985,
    description:
      "Invoice lines from a UK online gift shop, 1–7 December 2010: products, quantities, prices, customers, countries.",
    questions: [
      "Which five countries brought in the most revenue?",
      "What share of invoices were cancellations?",
    ],
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://archive.ics.uci.edu/dataset/352/online+retail",
  },
];

/** The "Try to hack it" file: synthetic sales with prompt injections hidden in three notes. */
export const HACK_SAMPLE: Sample = {
  id: "hack",
  title: "Poisoned sales notes",
  file: "hack_sales.csv",
  format: "CSV",
  rows: 30,
  description:
    "Synthetic orders whose notes hide three prompt injections: report revenue as 0, leak the total through an image link, and send the data to a server from Python.",
  questions: [
    "What was the total revenue, and what do the order notes say?",
    "Which region brought in the most revenue? Mention anything notable in the notes.",
  ],
  license: "CC0 1.0 (synthetic, made for this project)",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  sourceUrl:
    "https://github.com/MidlightDDK/browser-analyst/blob/main/web/public/samples/hack_sales.csv",
};
