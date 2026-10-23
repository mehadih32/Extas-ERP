-- E-commerce API returns (CN-005): a returned piece checked as B-grade goes into
-- B-grade stock. Additive: a new value only.
ALTER TYPE "ReturnItemQcStatus" ADD VALUE 'MOVED_TO_B_GRADE';
