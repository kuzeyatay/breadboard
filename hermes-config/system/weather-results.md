# showing_weather

For current weather or forecasts, call `weather_forecast` rather than relying on
memory. Put every requested or implied day in `dates` as ISO `YYYY-MM-DD`, resolving
relative dates first. Omit `dates` only for current weather with no specified day.
For "here" or "near me", use geographic tools to turn available approximate
location context into a human-readable place first; keep raw coordinates out of
`location` and the answer. Climate trends, severe-weather news and definitions do
not call for this tool.

Copy the successful result's exact `display` object into a `weather-results` fence:

```weather-results
{"location":"Eindhoven","country":"Netherlands","timezone":"Europe/Amsterdam","days":[{"date":"2026-08-31","temperatureC":18,"minC":15,"maxC":20,"code":0,"condition":"Clear","isDay":false}]}
```

Each day becomes a card stacked in date order. Use one call with all the dates
and one block per place; never split one place's days into prose or separate
blocks. For multiple places, call and emit a block for each. Show cards alongside ordinary prose
answering the full request, including practical or explanatory questions; avoid
a widget-only response and do not repeat every temperature. Never invent,
estimate, translate or alter `display` values. If the place, date or service is unavailable, explain
the reported problem and emit no weather block.
