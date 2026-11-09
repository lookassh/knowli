# Wymiana na czas Xboxa — realizacja ręczna

## Reguła

Każdy pełny blok 30 zaliczonych minut w jednym lokalnym dniu tworzy uprawnienie do 15 minut Xboxa za 30 punktów. 60 minut daje 2 pakiety, 90 minut 3; jeden blok nie finansuje dwóch wymian. Gotowe uprawnienia można zrealizować później (A3), bez łączenia niepełnych dni do nowego bloku.

Rodzina korzysta z Microsoft Family Safety/Xbox Family; każde dziecko ma osobne konto. Umiem! nie steruje konsolą i nie przechowuje hasła ani tokenu Microsoft. Bez konfiguratora przeliczników: kontrakt początkowy to 30 punktów i 15 minut.

## Zgłoszenie i decyzja

1. Dziecko wybiera jeden pakiet „Xbox: 15 minut za 30 pkt”. Serwer sprawdza saldo i niewykorzystane uprawnienie, rezerwuje je atomowo i tworzy jedno aktywne zgłoszenie dziecka. Zapisuje źródłowy dzień/blok oraz migawkę ceny i minut.
2. Rodzic w chronionym panelu otwiera kartę pracy źródłowego dnia i rundę. Przy kilku pakietach tego dnia nie powtarzamy rundy.
3. Po decyzji rodzic ręcznie dodaje czas właściwemu kontu w Xbox Family, gdy dziecko jest gotowe grać, i potwierdza realizację w Umiem!.
4. Potwierdzenie raz zamienia rezerwację punktów i uprawnienia w wykorzystanie. Komunikat: „Rodzic potwierdził dodanie 15 minut”, nie „Konsola odblokowana”. Kolejne uprawnienie można zgłosić po zamknięciu poprzedniego zgłoszenia.

Odrzucenie przed dodaniem czasu zwalnia punkty i uprawnienie, nie kasuje dorobku. Rodzic nie nadaje oceny oszustwa ani nie zabiera punktów. Dwie karty przeglądarki nie rezerwują tych samych punktów/bloku.

Microsoft i zapis Umiem! nie są wspólną transakcją. Przy niepewnym rezultacie rodzic sprawdza stan przed ponownym dodaniem czasu lub anulowaniem. Retry Umiem! nie oznacza nowej realizacji. Stare zgłoszenie rozliczamy według migawki, również następnego dnia.

## Zakres

Bez automatycznego nadawania minut, API Microsoft, sterowania zasilaniem i Home Assistant. Informacja o realizacji jest deklaracją rodzica; czas konsoli pozostaje w Xbox Family.

Źródła obsługi rodzica: [Xbox Family Settings](https://www.xbox.com/en-US/apps/family-settings-app), [Microsoft — limity czasu](https://support.microsoft.com/en-us/family-safety/set-screen-time-limits-across-devices). Nie testowano rodzinnego konta i nie zmieniano jego ustawień.
