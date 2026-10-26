# Tuloshuuto

Pieni TypeScript-työkalu, joka muuntaa Palloliiton Tulospalvelun ottelukalenterit
Nimenhuutoon tuotaviksi ICS-tiedostoiksi:

- Otsikosta poistetaan sarjan nimi ja alkuun lisätään joukkueen tunnus, esimerkiksi
  `M50: KaVo – Soho Seniors`.
- Kuvauksen alkuun lisätään pelipaikka. Nimenhuuto tuo kuvauksen lisätietoihin,
  mutta ei kokeilun perusteella täytä paikkakenttäänsä ICS:n `LOCATION`-kentästä.
- Ajat, aikavyöhykkeet, tunnisteet ja muut tiedot säilyvät merkitykseltään.

**Tuonti on kertaluonteinen.** Muutokset eivät synkronoidu Nimenhuutoon. Toistuva
tuonti voi luoda kaksoiskappaleita; työkalu ei poista niitä.

## Paikallinen käyttö

Tarvitset Node.js 24:n ja pnpm 11.25.0:n (versiot on kiinnitetty
`.node-version`- ja `package.json`-tiedostoissa). Asenna pnpm esimerkiksi
`npm install --global pnpm@11.25.0` tai käytä olemassa olevaa versionhallintaasi.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm generate
```

Yksi joukkue tai vaihtoehtoinen asetustiedosto:

```sh
pnpm generate --team m50
pnpm generate --config teams.json --report .reports/generation.json
```

Komennot suoritetaan repositorion juuresta. Tiedostot syntyvät `docs/`-hakemistoon,
ja komentorivi tulostaa onnistuneiden kalenterien täydet julkiset kohdeosoitteet.
Generointi yksin ei julkaise mitään GitHubiin.

Oletusraportti on `.reports/generation.json`. Siinä ovat ajon tunniste, kokonaistila
ja joukkuekohtaiset tilat, tapahtumamäärät, muutosliput sekä mahdolliset virheet.
Epäonnistuneen joukkueen tapahtumamäärä ja muutoslippu ovat `null`.
Raporttia ei julkaista Pagesiin eikä sitä seurata Gitissä.

Generointikomento käyttää Node 24:n `--use-env-proxy`-valintaa, joten fetch
kunnioittaa ympäristön `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`-asetuksia.
Salli tarvittaessa verkkoyhteys `spl.torneopal.fi`-osoitteeseen. Jokaisella latauksella
on 30 sekunnin kokonaisaikakatkaisu, joka kattaa myös vastauksen lukemisen.

## Joukkueiden asetukset

Muokkaa `teams.json`-tiedostoa. Mukana on speksissä annettu M50-kalenteri.

```json
{
  "pagesBaseUrl": "https://kranto.github.io/tuloshuuto",
  "teams": [
    {
      "id": "m50",
      "prefix": "M50",
      "url": "https://spl.torneopal.fi/calendar/team/35151943?t=1793022772050"
    }
  ]
}
```

Lisää M45, 7IDV tai muut joukkueet listaan niiden omilla lähdeosoitteilla.
`id` määrittää tiedostonimen, esimerkiksi `m50.ics`. Sen pitää olla uniikki ja
vastata muotoa `[a-z0-9_-]+`. `prefix` määrittää otsikon tunnuksen.
Lähdeosoitteen ja Pages-perusosoitteen pitää olla HTTPS-osoitteita.

**Pages-kalenterit ovat julkisia.** Varmista, että lähteen tapahtumat, kuvaukset
ja muut säilytettävät tiedot saa julkaista. Lähdeosoitteen kyselyparametri voi
toimia pääsyavaimena. Älä tallenna yksityistä osoitetta julkiseen repositorioon.
Työkalu ei lisää lähdeosoitetta raportteihin eikä tulosta palvelimen vastauksia
virhelokeihin. Lähtökalenterin omat tapahtumaominaisuudet kuitenkin säilytetään.

## GitHub Pages ja manuaalinen ajo

1. Vie toteutus repositorion `main`-haaraan.
2. Valitse repositorion **Settings → Pages → Build and deployment → Source:
   GitHub Actions**. Haarasta julkaisemista ei käytetä.
3. Salli Actionsille repositorion kirjoitusoikeus organisaation käytäntöjen
   mukaisesti. Workflow tarvitsee generointityölle `contents: write` sekä
   Pages-julkaisulle `pages: write` ja `id-token: write`. Muiden töiden oikeus
   on `contents: read`. Julkaisun ympäristön nimi on `github-pages`.
4. Varmista, että haarasuojaus sallii workflow'n kalentericommitit. Jos käytäntö
   estää ne, ajo epäonnistuu eikä julkaise repo-tilasta poikkeavaa sisältöä.
   Oletustoteutus käyttää `GITHUB_TOKEN`-tokenia, eikä tarvitse PAT-tokenia.
5. Valitse **Actions → Generate calendars → Run workflow**, haarana `main`.
6. Avaa ajon **summary**-työn Job Summary. Siinä näkyvät joukkueiden tilat,
   tapahtumamäärät, virheet, klikattavat linkit ja erikseen kopioitavat osoitteet.

Workflow tarkistaa tyypit ja testit, generoi kalenterit, commitoi vain muuttuneet
onnistuneet ICS-tiedostot ja julkaisee `docs/`-hakemiston Pages-artifaktina.
Julkaisu tehdään erikseen, koska `GITHUB_TOKEN`-tokenilla tehty commit ei käynnistä
haarapohjaista Pages-julkaisua. Ajoja ei ole ajastettu. Rinnakkaiset ajot eivät
päivitä kalentereita yhtä aikaa; GitHub voi korvata odottavan ajon uudemmalla.

Yhden joukkueen virhe ei estä muiden onnistuneiden tulosten commitointia ja
julkaisua. Koko ajo merkitään silti lopuksi epäonnistuneeksi. Jos kaikki joukkueet
epäonnistuvat, commitointi ja julkaisu ohitetaan. Push-virhe estää julkaisun.
Yhteenveto erottaa generoinnin, repositorion päivityksen ja julkaisun tilat.
Pelkkä generoinnin onnistuminen ei takaa, että linkissä on uusi kalenteri.
Onnistuneenkin Pages-julkaisun jälkeen sisällön päivittymisessä voi olla viive.

## Tuonti Nimenhuutoon

Kopioi onnistuneen julkaisun jälkeen oman joukkueesi ICS-osoite Job Summarysta.
Anna se Nimenhuudon kalenterituonnissa, tarkista esikatselun otsikot, pelipaikat,
päivät ja kellonajat ja hyväksy vasta sitten tuonti. Voit siirtää kuvauksen alussa
olevan pelipaikan Nimenhuudon paikkakenttään.

Ensimmäiseen käyttöönottoon kuuluu oikea Pages-lataus ja Nimenhuudon esikatselu.
Automaattiset testit eivät korvaa tätä palvelujen välistä yhteensopivuustarkistusta.

## Virhetilanteet ja tietojen säilyminen

Verkkovirhe, vanhentunut lähdeosoite, tyhjä vastaus, nollan ottelun kalenteri,
virheellinen ICS tai kirjoitusvirhe säilyttää edellisen kalenteritiedoston.
Uusi tiedosto validoidaan ja kirjoitetaan atomisesti saman hakemiston väliaikaisen
tiedoston kautta. Muuttumattomia tiedostoja ei kirjoiteta uudelleen. Vanhoja
kalentereita ei poisteta automaattisesti edes joukkueen poistuessa asetuksista.

Virhe yhdessä tapahtumassa hylkää koko kyseisen joukkueen uuden kalenterin.
Tapahtumalta vaaditaan `UID`, `DTSTAMP`, `DTSTART` ja `SUMMARY`. Puuttuvia paikkoja,
kuvauksia tai päättymisaikoja ei keksitä. Tuntemattomat ominaisuudet, parametrit,
aikavyöhykemääritykset ja hälytykset säilytetään. Tarkempi sopimus on
[toteutusspeksissä](SPEC.md).

Testit käyttävät paikallisia kalenterifixtureita, fetch-korvikkeita ja
aikakatkaisuihin paikallista HTTP-palvelinta. Git-commitointi testataan paikallista
bare-repositoriota vasten. Testit eivät tarvitse Tulospalvelua tai GitHubia.
