import { Prisma } from "@prisma/client";

import { amountInWords } from "@/lib/amount-words";
import { AppError } from "@/lib/errors";
import { formatAmount, formatInstantDay } from "@/lib/format";
import type { CompanyContext } from "@/modules/auth/context";
import { complianceNumbers } from "@/modules/compliance/compliance.service";
import { sizeBreakdownText, sizeOrderOf } from "@/modules/documents/builders";
import type { TemplateData } from "@/modules/templates/resolve";
import type { TemplateType } from "@/modules/templates/tags";
import { getChallanDocument, getInvoiceDocument } from "@/modules/sales/documents.service";
import { getProforma } from "@/modules/sales/proforma.service";
import { getQuotation } from "@/modules/sales/quotation.service";

/*
 * The data a template prints, by source path (tags.ts), read through the same
 * functions as the screens and the standard PDFs, and formatted the same way:
 * dates in company time ("2 Oct 2026"), amounts with the company's grouping
 * (12,34,567.50 for taka). Delivery challans carry no prices.
 */

/** How the filled copy is filed (GeneratedDocument columns). */
export type FilledRecord = {
  title: string;
  referenceType: string | null;
  referenceId: string | null;
  partyId: string | null;
};

type Party = {
  id?: string;
  code?: string | null;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
};

const text = (value: string | null | undefined) => value?.trim() ?? "";

function buyerValues(party: Party | null): Record<string, string> {
  if (!party) return {};
  return {
    "buyer.name": text(party.name),
    "buyer.code": text(party.code),
    "buyer.contactPerson": text(party.contactPerson),
    "buyer.phone": text(party.phone),
    "buyer.email": text(party.email),
    "buyer.address": text(party.address),
    "buyer.taxId": text(party.taxId),
  };
}

/** Everything a template can print for one document (or the letterhead). */
export async function templateData(
  ctx: CompanyContext,
  type: TemplateType,
  input: { id?: string; partyId?: string },
  now: Date,
): Promise<{ data: TemplateData; record: FilledRecord }> {
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  // Quotations carry their own currency; everything else is in the company's.
  const money = (value: Prisma.Decimal.Value, cur = currency) => formatAmount(value, 2, cur);
  const count = (value: number, cur = currency) => formatAmount(value, 0, cur);
  const day = (at: Date | null | undefined) => (at ? formatInstantDay(at, tz) : "");
  const numbers = await complianceNumbers(ctx.company.id);
  const company = ctx.company;
  const values: Record<string, string> = {
    "company.name": company.name,
    "company.legalName": text(company.legalName) || company.name,
    "company.address": text(company.address),
    "company.phone": text(company.phone),
    "company.email": text(company.email),
    "company.website": text(company.website),
    "company.bin": numbers.bin ?? "",
    "company.tin": numbers.tin ?? "",
    "company.tradeLicense": numbers.tradeLicense ?? "",
    "company.irc": numbers.irc ?? "",
    "company.erc": numbers.erc ?? "",
    "document.today": formatInstantDay(now, tz),
    "document.currency": currency,
  };
  const need = (what: string) => {
    if (!input.id)
      throw new AppError("VALIDATION", `Choose the ${what} to fill in.`, { id: ["Required"] });
    return input.id;
  };

  switch (type) {
    case "QUOTATION": {
      const q = await getQuotation(ctx, need("quotation"));
      const cur = q.currency;
      const sizeOrder = await sizeOrderOf(ctx);
      Object.assign(values, buyerValues(q.party), {
        "document.currency": cur,
        "document.number": q.number,
        "document.date": day(q.issueDate),
        "quotation.number": q.number,
        "quotation.date": day(q.issueDate),
        "quotation.validUntil": day(q.validUntil),
        "amount.subtotal": money(q.subtotal, cur),
        "amount.discount": money(q.discount, cur),
        "amount.tax": money(q.tax, cur),
        "amount.total": money(q.total, cur),
        "amount.words": amountInWords(q.total, cur),
        "document.totalQuantity": count(
          q.items.reduce((s, i) => s + i.quantity, 0),
          cur,
        ),
        "document.terms": text(q.terms),
        "document.notes": text(q.notes),
      });
      return {
        data: {
          values,
          items: q.items.map((item, i) => ({
            "item.no": String(i + 1),
            "item.description": item.description,
            "item.style": item.style ? `${item.style.code} ${item.style.name}` : "",
            "item.color": text(item.colorNote),
            "item.sizes": sizeBreakdownText(item.sizeBreakdown, sizeOrder, cur) ?? "",
            "item.fabric": text(item.fabric),
            "item.quantity": count(item.quantity, cur),
            "item.unitPrice": money(item.unitPrice, cur),
            "item.amount": money(item.lineTotal, cur),
          })),
        },
        record: {
          title: `Quotation ${q.number}`,
          referenceType: "Quotation",
          referenceId: q.id,
          partyId: q.partyId,
        },
      };
    }
    case "PROFORMA_INVOICE": {
      const pi = await getProforma(ctx, need("proforma invoice"));
      const quotation = pi.quotation;
      const cur = quotation?.currency ?? currency;
      const sizeOrder = await sizeOrderOf(ctx);
      const items = quotation?.items ?? [];
      Object.assign(values, buyerValues(pi.party), {
        "document.currency": cur,
        "document.number": pi.number,
        "document.date": day(pi.issueDate),
        "proforma.number": pi.number,
        "proforma.date": day(pi.issueDate),
        "quotation.number": quotation?.number ?? "",
        "amount.subtotal": money(quotation?.subtotal ?? pi.total, cur),
        "amount.discount": money(quotation?.discount ?? 0, cur),
        "amount.tax": money(quotation?.tax ?? 0, cur),
        "amount.total": money(pi.total, cur),
        "amount.words": amountInWords(pi.total, cur),
        "proforma.advancePercent": `${new Prisma.Decimal(pi.advancePercent).toDecimalPlaces(2).toString()}%`,
        "proforma.advanceAmount": money(pi.advanceAmount, cur),
        "proforma.advancePaid": money(pi.advancePaid, cur),
        "proforma.advanceDue": money(pi.advanceDue, cur),
        "proforma.balanceDue": money(pi.balanceDue, cur),
        "document.totalQuantity": count(
          items.reduce((s, i) => s + i.quantity, 0),
          cur,
        ),
        "document.terms": text(quotation?.terms),
      });
      return {
        data: {
          values,
          items: items.map((item, i) => ({
            "item.no": String(i + 1),
            "item.description": item.description,
            "item.style": item.style ? `${item.style.code} ${item.style.name}` : "",
            "item.color": text(item.colorNote),
            "item.sizes": sizeBreakdownText(item.sizeBreakdown, sizeOrder, cur) ?? "",
            "item.fabric": text(item.fabric),
            "item.quantity": count(item.quantity, cur),
            "item.unitPrice": money(item.unitPrice, cur),
            "item.amount": money(item.lineTotal, cur),
          })),
        },
        record: {
          title: `Proforma invoice ${pi.number}`,
          referenceType: "ProformaInvoice",
          referenceId: pi.id,
          partyId: pi.partyId,
        },
      };
    }
    case "COMMERCIAL_INVOICE": {
      const inv = await getInvoiceDocument(ctx, need("invoice"));
      Object.assign(values, buyerValues(inv.buyer), {
        "document.number": inv.number,
        "document.date": day(inv.issueDate),
        "invoice.number": inv.number,
        "invoice.date": day(inv.issueDate),
        "invoice.dueDate": day(inv.dueDate),
        "order.number": inv.orderNumber,
        "amount.subtotal": money(inv.subtotal),
        "amount.discount": money(inv.discount),
        "amount.deliveryCharge": money(inv.shippingCharge),
        "amount.tax": money(inv.tax),
        "amount.total": money(inv.total),
        "amount.words": amountInWords(inv.total, currency),
        "amount.paid": money(inv.paidAmount),
        "amount.due": money(inv.dueAmount),
        "document.totalQuantity": count(inv.items.reduce((s, i) => s + i.quantity, 0)),
      });
      return {
        data: {
          values,
          items: inv.items.map((item, i) => ({
            "item.no": String(i + 1),
            "item.description": `${item.style} – ${item.color} / ${item.size}`,
            "item.style": item.style,
            "item.sku": item.sku,
            "item.color": item.color,
            "item.size": item.size,
            "item.quantity": count(item.quantity),
            "item.unitPrice": money(item.unitPrice),
            "item.discount": money(item.discount),
            "item.amount": money(item.lineTotal),
          })),
        },
        record: {
          title: `Invoice ${inv.number}`,
          referenceType: "Invoice",
          referenceId: inv.id,
          partyId: "id" in inv.buyer ? inv.buyer.id : null,
        },
      };
    }
    case "DELIVERY_CHALLAN": {
      const ch = await getChallanDocument(ctx, need("delivery challan"));
      const { order } = ch;
      const receiver: Party = order.party ?? {
        name: order.customerName ?? "Walk-in customer",
        phone: order.customerPhone,
      };
      Object.assign(values, buyerValues(receiver), {
        "document.number": ch.number,
        "document.date": day(ch.deliveryDate),
        "challan.number": ch.number,
        "challan.date": day(ch.deliveryDate),
        "order.number": order.number,
        "challan.vehicleNo": text(ch.vehicleNo),
        "challan.driverName": text(ch.driverName),
        "challan.driverPhone": text(ch.driverPhone),
        "challan.receivedBy": text(ch.receivedBy),
        "challan.deliveryAddress": text(order.shippingAddress ?? receiver.address),
        "document.totalQuantity": count(ch.totalPieces),
        "document.notes": text(ch.notes),
      });
      return {
        data: {
          values,
          items: ch.items.map((item, i) => ({
            "item.no": String(i + 1),
            "item.description": `${item.style} – ${item.color} / ${item.size}`,
            "item.style": item.style,
            "item.sku": item.sku,
            "item.color": item.color,
            "item.size": item.size,
            "item.quantity": count(item.quantity),
          })),
        },
        record: {
          title: `Delivery challan ${ch.number}`,
          referenceType: "DeliveryChallan",
          referenceId: ch.id,
          partyId: order.party?.id ?? null,
        },
      };
    }
    case "LETTERHEAD": {
      const party = input.partyId
        ? await ctx.db.party.findUnique({ where: { id: input.partyId } })
        : null;
      if (input.partyId && !party) throw new AppError("NOT_FOUND", "Buyer or supplier not found.");
      Object.assign(values, buyerValues(party));
      return {
        data: { values, items: [] },
        record: {
          title: party ? `Letter to ${party.name}` : "Letterhead",
          referenceType: party ? "Party" : null,
          referenceId: party?.id ?? null,
          partyId: party?.id ?? null,
        },
      };
    }
  }
}
