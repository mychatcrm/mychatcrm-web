import type { CommercialCoupon } from "@/lib/commercial/types";

export const INTERNAL_TEST_PROVISIONING_COUPON_CODE = "TEST100";
export const INTERNAL_TEST_PROVISIONING_MARKER = "[internal-test-provisioning]";

export function isInternalTestProvisioningCoupon(coupon: CommercialCoupon | null | undefined): boolean {
  if (!coupon) return false;
  return (
    coupon.code === INTERNAL_TEST_PROVISIONING_COUPON_CODE &&
    coupon.active &&
    coupon.createPublicCode === false &&
    coupon.discountType === "percent" &&
    coupon.discountValue >= 100 &&
    !coupon.stripeCouponId &&
    !coupon.stripePromoCodeId &&
    coupon.description.includes(INTERNAL_TEST_PROVISIONING_MARKER)
  );
}

