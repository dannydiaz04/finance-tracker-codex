import { BadgeCheck, Repeat2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMerchantInsights } from "@/lib/queries/merchants";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default async function MerchantsPage() {
  const merchants = await getMerchantInsights();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Merchants"
        title="Track merchant aliases, recurring spend, and concentration risk."
        description="Merchant normalization feeds both reporting and rule creation, which makes this screen the bridge between exploration and ETL tuning."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {merchants.map((merchant) => (
          <Card key={merchant.merchant}>
            <CardHeader>
              <CardTitle className="text-base">{merchant.merchant}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-semibold text-white">
                {formatCurrency(merchant.spend)}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{merchant.transactions} txns</Badge>
                <Badge>trend {formatPercent(merchant.trend)}</Badge>
                {merchant.likelyRecurring ? (
                  <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                    recurring
                  </Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Repeat2 className="size-5 text-cyan-300" />
            <CardTitle className="text-base">Recurring candidates</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-7 text-slate-300">
            Merchants with stable cadence and amounts become prime rule candidates
            for subscription tagging and alerting.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <BadgeCheck className="size-5 text-emerald-300" />
            <CardTitle className="text-base">Alias management</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-7 text-slate-300">
            Merchant aliases are modeled in the ops layer so future imports normalize
            before classification and search indexing.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
