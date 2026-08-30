import assert from 'node:assert';
import { describe, it } from 'node:test';

import { htmlToText, parseDuckDuckGoResults } from './direct-search';

describe('DuckDuckGo result parsing', () => {
  it('reads the full HTML endpoint markup', () => {
    const html = `
      <div class="result results_links">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="https://example.org/teams">Teams &amp; Rosters</a>
        </h2>
        <a class="result__snippet" href="https://example.org/teams">Thirty <b>teams</b> in total.</a>
      </div>
      <div class="result results_links">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="https://example.net/other">Other</a>
        </h2>
      </div>`;
    const results = parseDuckDuckGoResults(html, 5);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.url, 'https://example.org/teams');
    assert.equal(results[0]?.title, 'Teams & Rosters');
    assert.equal(results[0]?.snippet, 'Thirty teams in total.');
  });

  it('unwraps redirector links and drops DuckDuckGo internals', () => {
    const html = `
      <a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa&rut=x">A</a>
      <a class="result-link" href="//duckduckgo.com/y.js?ad=1">Sponsored</a>`;
    const results = parseDuckDuckGoResults(html, 5);
    assert.deepEqual(
      results.map(result => result.url),
      ['https://example.org/a'],
    );
  });

  it('returns nothing for a challenge page rather than throwing', () => {
    // DuckDuckGo answers a rate-limited client with HTTP 202 and a page that
    // has no results in it. Parsing to zero is the signal to try elsewhere.
    assert.deepEqual(
      parseDuckDuckGoResults('<html><body>anomaly detected</body></html>', 5),
      [],
    );
  });

  it('honors the limit', () => {
    const html = Array.from(
      { length: 10 },
      (_, index) =>
        `<a class="result__a" href="https://example.org/${index}">Result ${index}</a>`,
    ).join('\n');
    assert.equal(parseDuckDuckGoResults(html, 3).length, 3);
  });
});

describe('page text extraction', () => {
  it('keeps the content region and drops navigation chrome', () => {
    const html = `
      <html><head><title>Roster</title></head>
      <body>
        <nav><a href="/a">Study</a><a href="/b">Living</a><a href="/c">Campus</a></nav>
        <main>
          <h1>Student teams</h1>
          <ul><li>Solar Team</li><li>Aero Team</li></ul>
          <p>Thirty teams, about 550 members.</p>
        </main>
        <footer>Contact us</footer>
      </body></html>`;
    const text = htmlToText(html);
    assert.match(text, /Student teams/);
    assert.match(text, /- Solar Team/);
    assert.match(text, /about 550 members/);
    assert.doesNotMatch(text, /Living/);
    assert.doesNotMatch(text, /Contact us/);
  });

  it('strips scripts and decodes entities', () => {
    const text = htmlToText(
      '<body><script>var teams = 30;</script><p>Team&nbsp;A &amp; Team B</p></body>',
    );
    assert.equal(text, 'Team A & Team B');
    assert.doesNotMatch(text, /var teams/);
  });
});
