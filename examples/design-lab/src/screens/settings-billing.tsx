import { Badge, Button, toast } from "@facilis/ui";
import { Card } from "../components/card.tsx";
import { plan } from "../data.ts";

/** Billing tab: plan summary, usage meters and payment method — all token-only composition. */
export function BillingPanel() {
  return (
    <>
      <Card
        title="Plan & usage"
        description="You are on the Scale plan, billed per seat."
        actions={
          <Badge tone="primary" className="lab-badge">
            Scale
          </Badge>
        }
      >
        <div className="lab-plan">
          <div>
            <p className="lab-plan__name">Scale</p>
            <p className="lab-hint">
              {plan.seats} · {plan.renewal}
            </p>
          </div>
          <p className="lab-plan__price">
            {plan.price}
            <span> {plan.cadence}</span>
          </p>
        </div>
        <div className="lab-usage-list">
          {plan.metrics.map((metric) => (
            <div className="lab-usage" key={metric.label}>
              <div className="lab-usage__head">
                <span className="lab-usage__label">{metric.label}</span>
                <span className="lab-tabular">{metric.detail}</span>
              </div>
              <div
                className="lab-meter"
                role="progressbar"
                aria-label={metric.label}
                aria-valuenow={metric.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: metric.percent + "%" }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Payment method"
        description="Used for the next renewal."
        actions={
          <Button variant="ghost" size="sm" onClick={() => toast.info("Billing portal opens here")}>
            Manage plan
          </Button>
        }
      >
        <div className="lab-form__row">
          <div className="lab-payment">
            <span className="lab-payment__brand">VISA</span>
            <div>
              <p className="lab-setting__title">Visa ending 4242</p>
              <p className="lab-setting__desc">Expires 08/2029 · {plan.renewal}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.info("Payment methods are managed by the billing owner")}
          >
            Update
          </Button>
        </div>
      </Card>
    </>
  );
}
