/*
 * A simple page to start an HTML template from, for each kind of document, with
 * the tags its data fills. The item row repeats once per line of the document.
 */

const page = (title: string, body: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1f2933; margin: 32px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #c9d2cc; padding: 6px 8px; text-align: left; }
  .right { text-align: right; }
  .muted { color: #5f6b66; }
</style>
</head>
<body>
<h1>{CompanyName}</h1>
<p class="muted">{CompanyAddress} · {CompanyPhone} · {CompanyEmail}</p>
${body}
</body>
</html>
`;

const buyer = `<p><strong>To:</strong> {BuyerName}<br>{BuyerAddress}<br>{BuyerPhone}</p>`;

const pricedItems = `<table>
  <tr><th>#</th><th>Item</th><th class="right">Quantity</th><th class="right">Unit price</th><th class="right">Amount</th></tr>
  <tr><td>{ItemNo}</td><td>{ItemDescription}</td><td class="right">{ItemQuantity}</td><td class="right">{ItemUnitPrice}</td><td class="right">{ItemAmount}</td></tr>
</table>`;

export const STARTER_HTML: Record<string, string> = {
  QUOTATION: page(
    "Quotation",
    `<h2>Quotation {QuotationNo}</h2>
<p>Date: {QuotationDate} · Valid until: {ValidUntil}</p>
${buyer}
${pricedItems}
<p class="right">Subtotal {Subtotal}<br>Discount {Discount}<br>VAT {Tax}<br><strong>Total {Currency} {TotalAmount}</strong></p>
<p>In words: {AmountInWords}</p>
<p>{Terms}</p>`,
  ),
  PROFORMA_INVOICE: page(
    "Proforma invoice",
    `<h2>Proforma invoice {ProformaNo}</h2>
<p>Date: {ProformaDate}</p>
${buyer}
${pricedItems}
<p class="right"><strong>Total {Currency} {TotalAmount}</strong><br>Advance ({AdvancePercent}) {AdvanceAmount}<br>Balance due {BalanceDue}</p>
<p>In words: {AmountInWords}</p>
<p>{Terms}</p>`,
  ),
  COMMERCIAL_INVOICE: page(
    "Invoice",
    `<h2>Invoice {InvoiceNo}</h2>
<p>Date: {InvoiceDate} · Order: {OrderNo} · Due: {DueDate}</p>
${buyer}
${pricedItems}
<p class="right">Subtotal {Subtotal}<br>Discount {Discount}<br>Delivery {DeliveryCharge}<br>VAT {Tax}<br><strong>Total {Currency} {TotalAmount}</strong><br>Paid {PaidAmount}<br>Due {DueAmount}</p>
<p>In words: {AmountInWords}</p>`,
  ),
  DELIVERY_CHALLAN: page(
    "Delivery challan",
    `<h2>Delivery challan {ChallanNo}</h2>
<p>Date: {ChallanDate} · Order: {OrderNo}</p>
${buyer}
<p>Deliver to: {DeliveryAddress}<br>Vehicle: {VehicleNo} · Driver: {DriverName} {DriverPhone}</p>
<table>
  <tr><th>#</th><th>Style</th><th>Colour</th><th>Size</th><th class="right">Quantity</th></tr>
  <tr><td>{ItemNo}</td><td>{ItemStyle}</td><td>{ItemColor}</td><td>{ItemSize}</td><td class="right">{ItemQuantity}</td></tr>
</table>
<p>Total pieces: {TotalQuantity}</p>
<p>Received by: {ReceivedBy}</p>`,
  ),
  LETTERHEAD: page(
    "Letter",
    `<p class="right">{Today}</p>
${buyer}
<p>Dear Sir or Madam,</p>
<p>Write your letter here.</p>
<p>Yours sincerely,<br><br><br>{CompanyName}</p>`,
  ),
};
