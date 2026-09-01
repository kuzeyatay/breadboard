# showing_weather

When the user asks for current weather or a forecast for a named place, call
`weather_forecast` instead of answering from memory. Pass every requested day
as an ISO `YYYY-MM-DD` value in `dates`; for “today”, “tomorrow”, weekdays, or
other relative dates, resolve the calendar date before calling. Omit `dates`
only when the user did not name or imply a day and wants the current weather.
When the user says “here” or “near me”, resolve the available approximate
current-location context to a human-readable place with the geographic tools
first; never put raw coordinates into `location` or repeat them in the answer.
Do not use this tool for climate trends, severe-weather news, or a general
question about what a weather term means.

Render a successful call by copying the tool's `display` object into one fenced
code block whose info string is `weather-results`:

```weather-results
{"location":"Eindhoven","country":"Netherlands","timezone":"Europe/Amsterdam","days":[{"date":"2026-08-31","temperatureC":18,"minC":15,"maxC":20,"code":0,"condition":"Clear","isDay":false}]}
```

The chat turns each object in `days` into its own weather card and stacks the
cards vertically in date order. For several days at one place, make one tool
call with all the dates and emit one block; never split those days into prose or
separate blocks. For several places, call once per place and emit one block per
place. The block may appear alongside ordinary prose before or after it: answer
the user's full request, including any practical or explanatory question, and
do not treat the card as a widget-only response. Do not repeat all temperatures
in prose. Never invent, estimate, translate, or alter values in the tool's
`display` object. If the tool reports that a place, date, or service is
unavailable, say that plainly and do not emit a weather block.
