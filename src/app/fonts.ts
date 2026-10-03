import localFont from "next/font/local";

/*
 * The fonts are bundled with the app (no call to Google at build time): Inter for
 * the interface, Playfair Display for headings and big figures, and the Noto Sans
 * Bengali the PDFs already use, for Bengali names. The Bengali font only downloads
 * on a screen that shows Bengali text.
 */

export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const playfair = localFont({
  src: "../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2",
  weight: "400 900",
  variable: "--font-playfair",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const bengali = localFont({
  src: [
    { path: "../../assets/fonts/NotoSansBengali-Regular.ttf", weight: "400" },
    { path: "../../assets/fonts/NotoSansBengali-Bold.ttf", weight: "700" },
  ],
  variable: "--font-bengali",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0964-0965, U+0980-09FE, U+200C-200D, U+25CC" }],
});

export const fontVariables = [inter.variable, playfair.variable, bengali.variable].join(" ");
