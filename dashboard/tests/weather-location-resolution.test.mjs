import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWeatherForecast} from '../src/lib/weather/forecast.ts';

const day={daily:{time:['2026-11-08'],weather_code:[51],temperature_2m_max:[10],temperature_2m_min:[7]}};
const place=(name,country,code,latitude,admin1='')=>({name,country,country_code:code,latitude,longitude:4.35,admin1});
function fixture(searches){
  const calls=[];
  return {calls,fetchImpl:async url=>{
    const parsed=new URL(url);calls.push(parsed);
    if(parsed.hostname==='api.open-meteo.com')return Response.json(day);
    const response=searches.shift();assert.ok(response,'no unbounded geocoding retries');
    return Response.json({results:response});
  }};
}
test('qualified places recover from a failed compound lookup with one validated fallback',async()=>{
  const f=fixture([[],[place('Delft','South Africa','ZA',-33),place('Delft','The Netherlands','NL',52,'South Holland')]]);
  const result=await fetchWeatherForecast({location:'Delft, Netherlands'},f);
  assert.equal(result.display.country,'The Netherlands');
  assert.deepEqual(f.calls.slice(0,2).map(u=>u.searchParams.get('name')),['Delft, Netherlands','Delft']);
  assert.equal(f.calls[2].searchParams.get('latitude'),'52');
});
test('fallbacks preserve all supplied regions and countries, case and diacritics',async()=>{
  const f=fixture([[],[place('San José','Costa Rica','CR',10,'San José'),place('San José','United States','US',37,'California')]]);
  const result=await fetchWeatherForecast({location:'San Jose, san jose, CR'},f);
  assert.equal(result.display.country,'Costa Rica');
});
test('a compound result in the wrong country is never accepted even when the city and region match',async()=>{
  const f=fixture([[place('Springfield','United States','US',40,'Illinois')],[place('Springfield','United States','US',40,'Illinois')]]);
  await assert.rejects(fetchWeatherForecast({location:'Springfield, Illinois, Canada'},f),{code:'weather_location_not_found'});
  assert.equal(f.calls.length,2);
});
test('a fallback never guesses between distinct equally qualified cities',async()=>{
  const f=fixture([[],[place('Springfield','United States','US',40),place('Springfield','United States','US',42)]]);
  await assert.rejects(fetchWeatherForecast({location:'Springfield, United States'},f),{code:'weather_location_not_found'});
  assert.equal(f.calls.length,2);
});
test('ordinary successful city lookup retains its two-request path',async()=>{
  const f=fixture([[place('Oslo','Norway','NO',60)]]);
  assert.equal((await fetchWeatherForecast({location:'Oslo'},f)).display.location,'Oslo');
  assert.equal(f.calls.length,2);
});

test('successful upstream region aliases stay supported while extra country constraints are checked',async()=>{
  const f=fixture([[place('Los Angeles','United States','US',34,'California')]]);
  assert.equal((await fetchWeatherForecast({location:'Los Angeles, CA, US'},f)).display.location,'Los Angeles');
  assert.equal(f.calls.length,2);
});
