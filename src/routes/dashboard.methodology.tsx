import { createFileRoute } from "@tanstack/react-router";
import { ChartCard } from "@/components/dashboard/atoms";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/methodology")({
  head: () => ({
    meta: [
      { title: "Data & Methodology — CEA Power Intelligence" },
      {
        name: "description",
        content: "Data sources, formulas and assumptions used in CEA Power Intelligence.",
      },
      { property: "og:title", content: "Data & Methodology — CEA Power Intelligence" },
      {
        property: "og:description",
        content: "Data sources, formulas and assumptions used in CEA Power Intelligence.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/methodology" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/methodology" }],
  }),
  component: MethPage,
});

function Formula({ name, expr, note }: { name: string; expr: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{name}</div>
      <code className="mt-2 block whitespace-pre-wrap font-mono text-sm">{expr}</code>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function MethPage() {
  const { t } = useLang();
  return (
    <div className="space-y-6">
      <ChartCard
        title={t(
          "Regional platform: provenance and coverage",
          "Regionalna platforma: poreklo i pokrivenost",
        )}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
          <li>
            {t(
              "Every figure in the regional workspaces carries one of seven states: LIVE (fetched from the provider now), OBSERVED (provider data from cache), STALE (last good provider data, provider unreachable), SYNTHETIC (generated development data, never a market observation), NO DATA (the provider published nothing), NOT CONNECTED (credentials or integration missing) and ERROR.",
              "Svaka vrednost u regionalnim radnim prostorima nosi jedno od sedam stanja: UŽIVO, IZMERENO (podatak provajdera iz keša), ZASTARELO (poslednji ispravan podatak, provajder nedostupan), SINTETIČKO (generisani razvojni podaci, nikad tržišno merenje), NEMA PODATAKA, NIJE POVEZANO i GREŠKA.",
            )}
          </li>
          <li>
            {t(
              "A missing value is shown as a dash. It is never replaced with zero, a typical value or an interpolation. A net cross-border flow is shown for an hour only when both directions were reported; a market's net position only when all of its borders reported.",
              "Nedostajuća vrednost se prikazuje kao crta. Nikada se ne zamenjuje nulom, tipičnom vrednošću ili interpolacijom. Neto prekogranični tok se prikazuje za sat samo kada su oba smera prijavljena; neto pozicija tržišta samo kada su sve njegove granice prijavile.",
            )}
          </li>
          <li>
            {t(
              "Coverage: Serbia, Bosnia and Herzegovina, Montenegro, North Macedonia, Albania, Kosovo*, Croatia, Slovenia, Bulgaria, Romania, Greece and Hungary, with Austria, three Italian zones, Türkiye, Slovakia, Ukraine and Moldova as connected markets. Bosnia and Herzegovina has no organised day-ahead market, so it has flows and fundamentals but no price.",
              "Pokrivenost: Srbija, Bosna i Hercegovina, Crna Gora, Severna Makedonija, Albanija, Kosovo*, Hrvatska, Slovenija, Bugarska, Rumunija, Grčka i Mađarska, uz Austriju, tri italijanske zone, Tursku, Slovačku, Ukrajinu i Moldaviju kao povezana tržišta. Bosna i Hercegovina nema organizovano day-ahead tržište, pa ima tokove i fundamente, ali ne i cenu.",
            )}
          </li>
          <li>
            {t(
              "Physical flows (measured) and scheduled commercial exchanges are different quantities and are never mixed or substituted for each other. Utilisation is |physical flow| ÷ day-ahead forecast NTC and is shown only where NTC is published.",
              "Fizički tokovi (izmereni) i planirane komercijalne razmene su različite veličine i nikada se ne mešaju niti zamenjuju. Iskorišćenost je |fizički tok| ÷ day-ahead prognoziran NTC i prikazuje se samo gde je NTC objavljen.",
            )}
          </li>
          <li>
            {t(
              "Not connected: intraday prices and indices, balancing and ancillary-service prices (FCR, aFRR, mFRR), JAO and SEE CAO auction feeds beyond what ENTSO-E republishes, and licensed forward prices. These appear as unavailable, not as estimates.",
              "Nije povezano: unutardnevne cene i indeksi, cene balansnih i pomoćnih usluga (FCR, aFRR, mFRR), JAO i SEE CAO aukcije izvan onoga što ENTSO-E objavljuje i licencirane terminske cene. Prikazuju se kao nedostupne, ne kao procene.",
            )}
          </li>
        </ul>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Formula
            name={t("Indicative spread", "Indikativni spread")}
            expr="spread_h = price_destination_h − price_source_h"
            note={t(
              "Matched hours only. Indicative, not an executable margin.",
              "Samo upareni sati. Indikativno, nije ostvariva marža.",
            )}
          />
          <Formula
            name={t("Illustrative net spread", "Ilustrativni neto spread")}
            expr="net = mean(max(spread_h, 0)) − capacity_price − other_costs"
            note={t(
              "Excludes losses, balancing exposure, nomination deadlines, curtailment and the timing gap between capacity auctions and day-ahead gate closure.",
              "Ne uključuje gubitke, balansnu izloženost, rokove nominacije, redukcije i vremenski razmak između aukcija kapaciteta i zatvaranja day-ahead tržišta.",
            )}
          />
          <Formula
            name={t("Price split on a coupled border", "Razdvajanje cena na spojenoj granici")}
            expr="split_share = hours(|spread_h| > 0.5 €/MWh) / matched_hours"
            note={t(
              "Under market coupling a price difference means the border was binding.",
              "Kod spajanja tržišta razlika u ceni znači da je granica bila ograničavajuća.",
            )}
          />
          <Formula
            name={t("Battery dispatch", "Dispečing baterije")}
            expr="max Σ_h price_h × (discharge_h − charge_h) − wear × discharge_h"
            note={t(
              "Solved exactly per delivery day by dynamic programming over state of charge, with power, SoC window, efficiency on both legs and a daily cycle limit. Perfect foresight of that day's prices: an upper bound.",
              "Rešava se tačno po danu isporuke dinamičkim programiranjem po stanju napunjenosti, uz snagu, SoC opseg, efikasnost na oba kraka i dnevni limit ciklusa. Savršeno predviđanje cena tog dana: gornja granica.",
            )}
          />
          <Formula
            name={t("PPA fair strike (pay-as-produced)", "Fer cena PPA (po proizvodnji)")}
            expr="K* = Σ_y DF_y × Σ_h gen_h × price_{y,h} / Σ_y DF_y × Σ_h gen_h"
            note={t(
              "The strike at which the contract and merchant sale have equal present value. price_{y,h} is the observed hourly shape rescaled to the forward baseload you enter for year y.",
              "Cena pri kojoj ugovor i merchant prodaja imaju jednaku sadašnju vrednost. price_{y,h} je izmereni satni oblik skaliran na terminski baseload koji unesete za godinu y.",
            )}
          />
          <Formula
            name={t("Cannibalisation stress", "Stres kanibalizacije")}
            expr="stressed_h = price_h × (1 − s × gen_h / max(gen)), rescaled to the same baseload"
            note={t(
              "A scenario input, not a forecast of capture rates.",
              "Ulaz scenarija, nije prognoza capture stopa.",
            )}
          />
        </div>
      </ChartCard>

      <ChartCard title={t("Data sources & status policy", "Izvori podataka i status podataka")}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
          <li>
            <strong>SEEPEX / ENTSO-E day-ahead data</strong> are the observed market-price inputs
            for Serbia. Regional ENTSO-E A44 series retain their published market time unit,
            including 15-minute intervals where applicable.
          </li>
          <li>
            <strong>ENTSO-E Transparency Platform</strong> also supplies actual generation by
            production type (A75), actual load, physical cross-border flows, outages and explicit
            allocation results.
          </li>
          <li>
            <strong>PVGIS (JRC, European Commission)</strong> is used for calculator PV profiles.
            Where Serbia B16 solar generation is unavailable for capture analytics, a clear-sky
            solar weighting proxy is used and explicitly labelled <em>modelled</em>.
          </li>
          <li>
            <strong>AERS, EMS, Ministry of Mining and Energy and Energy Community</strong> provide
            regulatory and policy context where stated.
          </li>
          <li>
            Statuses distinguish observed live data, cached observed data, partial coverage,
            modelled/estimated values and unavailable data. Synthetic/demo values must never
            silently replace an observed market KPI.
          </li>
        </ul>
      </ChartCard>

      <ChartCard title={t("Market formulas", "Tržišne formule")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Formula
            name="Baseload price"
            expr="baseload = Σ price_interval × duration / Σ duration"
            note="Calculated only from complete Europe/Belgrade delivery days. A complete hourly delivery day contains every expected interval: 23, 24 or 25 hours depending on DST."
          />
          <Formula
            name="Peakload price"
            expr="peakload = mean(price[Mon–Fri & 08:00–20:00 Europe/Belgrade])"
            note="Uses the same complete-day sample as baseload."
          />
          <Formula
            name="Negative price intervals"
            expr="negative_intervals = count(observed_price < 0)"
            note="Missing observations are not converted to zero."
          />
          <Formula
            name="Regional spread"
            expr="spread_h = regional_price_h − Serbia_price_h"
            note="Mixed 15/60-minute markets are aligned to a common hourly comparison level using duration-weighted prices before spreads are calculated."
          />
          <Formula
            name="Solar capture price"
            expr="capture_solar = Σ(price_h × solar_h) / Σ(solar_h)"
            note="Only matched price/generation timestamps enter observed-generation capture calculations. Missing ENTSO-E generation is not forward-filled."
          />
          <Formula
            name="Wind capture price"
            expr="capture_wind = Σ(price_h × wind_h) / Σ(wind_h)"
            note="Onshore and offshore series are explicitly aggregated where both are published. Missing wind observations remain missing rather than 0 MW."
          />
          <Formula
            name="Capture rate"
            expr="capture_rate = capture_price / baseload"
            note="Below 100% indicates that the technology earns below the reference baseload price over the comparable sample."
          />
          <Formula name="Merchant revenue" expr="merchant_revenue = Σ(generation_h × price_h)" />
        </div>
      </ChartCard>

      <ChartCard title={t("Coverage rules", "Pravila pokrivenosti podacima")}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
          <li>
            <strong>Complete</strong> means the selected range is covered without internal missing
            or incomplete days and without failed/capped source fetches.
          </li>
          <li>
            <strong>Partial</strong> is shown whenever range bounds are incomplete, an internal day
            is missing/incomplete, a source fetch failed or the fetch cap was reached.
          </li>
          <li>
            Cached data are labelled separately as <strong>cached-complete</strong> or
            <strong> cached-partial</strong>. An unavailable source is not represented as numeric
            zero.
          </li>
          <li>
            Physical-flow net positions require both directions for the same timestamp. If either
            direction is missing, net flow for that timestamp is unavailable rather than assumed 0
            MW.
          </li>
        </ul>
      </ChartCard>

      <ChartCard title={t("Project Economics methodology", "Metodologija ekonomike projekata")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Formula
            name={t("Futures-anchored hourly scenario", "Futures-usidreni satni scenario")}
            expr="expected_price_h = historical_shape_h + target_month − historical_month_average"
            note={t(
              "Month contracts take priority, then quarter, then calendar year. Later-year annual values are weighted by Europe/Belgrade delivery hours, including leap years and DST. Missing settlements are never fabricated.",
              "Mesečni ugovori imaju prioritet, zatim kvartalni i godišnji. Godišnje vrednosti za kasnije godine ponderišu se stvarnim brojem sati isporuke u Europe/Belgrade, uključujući prestupne godine i DST. Nedostajuća poravnanja se ne izmišljaju.",
            )}
          />
          <Formula
            name={t("Renewable settlement", "Poravnanje OIE")}
            expr="revenue_h = PPA_settlement_h + merchant_settlement_h"
            note={t(
              "Annual and monthly revenue use the same hourly settlement engine. Fixed/pay-as-produced, partial PPA and baseload PPA therefore reconcile exactly between monthly and annual views.",
              "Godišnji i mesečni prihod koriste isti satni settlement engine, pa se fixed/pay-as-produced, partial PPA i baseload PPA tačno usklađuju između mesečnog i godišnjeg prikaza.",
            )}
          />
          <Formula
            name={t("BESS dispatch", "BESS dispečiranje")}
            expr="SOC_h = SOC_(h−1) + charge_h × η_charge − discharge_h / η_discharge"
            note={t(
              "The deterministic arbitrage heuristic enforces power, energy, SOC, availability, grid and local-day cycle limits. A cycle is dispatched only when the spread remains economic after round-trip losses and variable throughput cost. Local days may contain 23, 24 or 25 hours.",
              "Deterministička arbitražna heuristika primenjuje limite snage, energije, SOC-a, raspoloživosti, mreže i ciklusa po lokalnom danu. Ciklus se aktivira samo kada spread ostane profitabilan nakon round-trip gubitaka i varijabilnog throughput troška. Lokalni dan može imati 23, 24 ili 25 sati.",
            )}
          />
          <Formula
            name="LCOS"
            expr="LCOS = discounted(CAPEX + OPEX + charging_cost + augmentation) / discounted_discharged_MWh"
            note="Lifetime discounted costs and discharged energy include degradation and augmentation assumptions."
          />
          <Formula
            name={t("Hybrid lifetime revenue", "Prihod hibrida kroz vek projekta")}
            expr="revenue_y = renewable_market/PPA_y + battery_merchant_y + tolling_y + ancillary_y"
            note={t(
              "Wholesale-price scenarios scale only market-linked revenue. Fixed battery tolling and ancillary revenue are not multiplied by power-price escalation or renewable degradation; battery merchant revenue follows battery capacity degradation.",
              "Scenario veleprodajne cene menja samo prihode vezane za tržište. Fiksni battery tolling i ancillary prihod ne množe se eskalacijom cene električne energije niti degradacijom OIE, dok battery merchant prihod prati degradaciju kapaciteta baterije.",
            )}
          />
          <Formula
            name={t("Hybrid allocation", "Hibridna alokacija")}
            expr="renewable export → clipped-energy charging → optional grid charging → constrained discharge"
            note={t(
              "All exports share one interconnection limit. Renewable energy that would otherwise be clipped is charged first when recovery is enabled.",
              "Sav izvoz deli jedan limit priključka. OIE energija koja bi inače bila odsečena prva puni bateriju kada je povrat uključen.",
            )}
          />
        </div>
      </ChartCard>

      <ChartCard title={t("Assumptions & limitations", "Pretpostavke i ograničenja")}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
          <li>Negative market prices are valid observations and are not treated as data errors.</li>
          <li>
            Capture analytics are only as complete as the matched price and generation coverage;
            coverage/source labels should be considered together with the KPI.
          </li>
          <li>
            Public ENTSO-E explicit-allocation quantities are auction results, not trader-owned or
            executable capacity. Route economics are expressed per MW unless executable capacity is
            supplied from a separately verified source.
          </li>
          <li>
            Project Economics is an indicative deterministic model, not a dispatch optimiser or
            bankable due-diligence model. Tax, detailed degradation engineering, financing covenants
            and market-access constraints may require project-specific modelling.
          </li>
          <li>This tool provides indicative analysis and is not financial or investment advice.</li>
        </ul>
      </ChartCard>
    </div>
  );
}
