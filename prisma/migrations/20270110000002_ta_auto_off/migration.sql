-- T&A: a person took back the ERP's own tick on a step, so the ERP stops ticking it by itself.
ALTER TABLE "OrderTaStep" ADD COLUMN "autoOff" BOOLEAN NOT NULL DEFAULT false;
