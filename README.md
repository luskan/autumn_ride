# Jesienna Trasa

Gra 3D w przeglądarce (three.js): jazda samochodem przez jesienną, pagórkowatą okolicę z ruchem w obu kierunkach i polskimi znakami drogowymi. Zagraj online: https://luskan.github.io/autumn_ride/

Jesienne tło ożywiają odległe klucze i pojedyncze ptaki oraz małe grupy startujące i lądujące za koronami drzew. Częstotliwość przelotów, odległości i limity ptaków można dostroić w `BIRDS` w `src/config.js`.

Sterowanie: strzałki (gaz, hamowanie, skręt), A - autopilot (trzyma prędkość i wyprzedza), C - kamera, M - dźwięk, P - pauza, mysz - obrót i przybliżenie kamery. Na telefonie (w poziomie) sterowanie jak w Roblox: joystick pod lewym kciukiem, przeciąganie po prawej stronie obraca kamerę.

Lokalnie: `npm install`, potem `npm run dev`; `npm run build` tworzy jeden samodzielny plik `dist/index.html`, a `npm test` uruchamia testy e2e w Chrome. Własne logo na ciężarówkach: plik `src/assets/truck-logo.png`.
