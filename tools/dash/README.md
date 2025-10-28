# Energiepreis Dashboard

Dieses Minimal-Dashboard liest die dynamischen Tarife der CKW-API und zeigt dir:

- eine Empfehlung fuer typische Stromverbraucher (E-Auto, Tumbler, Heizung, Boiler)
- ein Preisbalkendiagramm fuer den gewaehlten Zeitraum
- eine detaillierte Tabelle mit allen Zeitslots und Preisen

## Projekt aufrufen

1. Oeffne die Datei `index.html` im Ordner `dash` direkt im Browser (Doppelklick oder per Rechtsklick > Oeffnen mit).
2. Passe im Formular den Tarif, den Zeitraum und optional den Tariftyp an.
3. Solange die Live-API nicht erreichbar ist, kannst du das Kontrollkaestchen **Demo-Daten verwenden** aktivieren. Dann werden synthetische Beispielpreise geladen, damit das Dashboard alle Funktionen zeigt.
4. Nach dem Laden siehst du die Empfehlung fuer jedes Geraet sowie das Preisdiagramm und die Tabelle.

> Hinweis: Laut Anbieter ist die API ab 13. Oktober 2025 produktiv verfuegbar. Sobald die Schnittstelle aktiv ist, deaktiviere den Demo-Modus, damit `fetch` echte Daten abruft.

## Anpassungsmoeglichkeiten

- **Weitere Geraete**: Erweitere das Array `APPLIANCES` in `app.js` um eigene Eintraege. Dauer und Beschreibung koennen frei gewaehlt werden.
- **Zeitzonen**: Im Formular wird der lokale Browser-Zeitstempel genutzt und intern in ISO 8601 (UTC) konvertiert, wie es die API erwartet.
- **Styling**: Passe Farben und Darstellung in `styles.css` an. Die Struktur nutzt einfache CSS-Grids und Karten.

## To-do / Ideen

- Export der empfohlenen Zeitfenster als Kalender oder ICS-Datei
- Benachrichtigungen (Push/E-Mail), sobald ein neuer optimaler Slot verfuegbar ist
- Darstellung mehrerer Tariftypen in einer kombinierten Visualisierung
