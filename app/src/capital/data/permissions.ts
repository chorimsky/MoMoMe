/* ============================================================
   Frontend permission model — derived from the SAME shared role module the
   server enforces with, so hiding a button never disagrees with a 403.
   `can(role, cap)` answers "may this role attempt this?"; the server is still
   the authority and every page handles a 401/403 with the no-permission state.
   ============================================================ */
import { canAccess, canApproveKyc, canVerifyFunding, canAllocateCapital, canAdjustLedger, canApproveRecommendation, canEditInvestors, canLegalReview, isInvestor, isReadOnly, isSuperAdmin, type AdminRole, type Section } from "@shared/roles.js";

export type Capability =
  | "view:intelligence" | "view:investors" | "view:capital" | "view:copilot" | "view:reports" | "view:portal" | "view:operations"
  | "edit:investors" | "kyc:approve" | "funding:verify" | "capital:allocate" | "ledger:adjust" | "recommendation:approve" | "recommendation:review"
  | "requirement:manage" | "legal:review" | "document:manage" | "campaign:manage" | "thresholds:set" | "portal:link" | "view:settings";

export function can(role: AdminRole, cap: Capability): boolean {
  const ro = isReadOnly(role);
  const sec = (s: Section) => canAccess(role, s);
  switch (cap) {
    case "view:intelligence": return sec("intelligence");
    case "view:investors": return sec("investors");
    case "view:capital": return sec("capital");
    case "view:copilot": return sec("copilot");
    case "view:reports": return sec("intelligence") || sec("capital");
    case "view:portal": return isInvestor(role) || isSuperAdmin(role);
    case "view:operations": return sec("overview") && !isInvestor(role);
    case "edit:investors": return !ro && canEditInvestors(role);
    case "kyc:approve": return !ro && canApproveKyc(role);
    case "funding:verify": return !ro && canVerifyFunding(role);
    case "capital:allocate": return !ro && canAllocateCapital(role);
    case "ledger:adjust": return !ro && canAdjustLedger(role);
    case "recommendation:approve": return !ro && canApproveRecommendation(role);
    case "recommendation:review": return !ro && (sec("intelligence") || sec("copilot"));
    case "requirement:manage": return !ro && canApproveRecommendation(role);
    case "legal:review": return !ro && canLegalReview(role);
    case "document:manage": return !ro && (canEditInvestors(role) || canLegalReview(role));
    case "campaign:manage": return !ro && canEditInvestors(role);
    case "thresholds:set": return !ro && canApproveRecommendation(role);
    case "portal:link": return !ro && isSuperAdmin(role);
    case "view:settings": return !isInvestor(role) && (sec("intelligence") || sec("investors") || sec("capital") || sec("copilot"));
  }
}
/** Where a role lands when it opens the module root. */
export function homeFor(role: AdminRole): string {
  if (isInvestor(role)) return "/investor/dashboard";
  if (can(role, "view:intelligence")) return "/capital-intelligence";
  if (can(role, "view:investors")) return "/investors";
  if (can(role, "view:capital")) return "/capital";
  if (can(role, "view:copilot")) return "/ai-copilot";
  return "/admin";
}
