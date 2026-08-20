# BESS economics audit

## P1: dispatch trigger ignores efficiency and variable throughput cost

`dailySignalSets()` selects the lowest and highest price hours and dispatches whenever the selected high price is greater than the selected low price. The selection criterion does not account for round-trip losses or variable throughput costs.

A spread can therefore be positive in nominal price terms but negative after charging/discharging losses and variable costs. `dispatchBess()` will still execute that cycle, producing economically irrational dispatch for small spreads.

Required remediation:

1. Gate each candidate charge/discharge pair using an efficiency-adjusted break-even condition.
2. Include variable throughput cost in the dispatch decision when the model is presented as merchant economics.
3. Add tests where high > low but the spread is smaller than losses/costs and confirm no dispatch occurs.
4. Keep the current heuristic clearly labelled as deterministic heuristic, not mathematical optimisation.

## P1: day grouping is fixed to 24 UTC hours

`dispatchBess()` slices the price vector into blocks of 24 rows. That assumes every modeled day has exactly 24 hourly observations and that array boundaries align with local delivery days.

The rest of the dashboard explicitly uses `Europe/Belgrade`, which has 23-hour and 25-hour DST days. A fixed 24-row grouping can move hours between local days around DST transitions and distort daily cycle limits.

Required remediation:

- group dispatch rows by local `Europe/Belgrade` delivery date, not array position;
- enforce daily cycle limits on each local delivery day;
- add 23-hour and 25-hour DST tests.

## P1: displayed LCOS does not match the documented discounted LCOS formula

The methodology page describes LCOS as discounted costs divided by discounted discharged MWh. `runBessEconomics()` currently reports a first-year approximation using `CAPEX / lifetimeYears + first-year fixed OPEX + first-year variable costs + first-year charging cost`, divided by first-year discharged MWh.

This is useful as a simple annualized operating indicator, but it is not the discounted lifetime LCOS described publicly.

Required remediation:

1. Either rename the current output to an annualized first-year cost indicator, or
2. calculate lifetime discounted LCOS using year-specific charging cost, OPEX, augmentation and discharged MWh.
3. Add a test showing degradation and augmentation affect lifetime LCOS.
