# 7. Il design dell'invisibilità

Ogni scelta visiva di questo progetto è una decisione concettuale. Non esiste un elemento estetico neutro: il colore dello sfondo, la dimensione delle particelle, la quantità di testo sull'interfaccia del telefono, tutto dice qualcosa su come si vuole che l'esperienza venga vissuta.

Il principio che guida queste scelte ha un nome paradossale: il design dell'invisibilità. L'obiettivo è che l'interfaccia sparisca, e che rimanga solo l'esperienza.

---

## 7.1 — Il nero come spazio

La prima scelta è stata il nero, inteso come ambiente. Lo sfondo è passivo, è ciò che c'è quando non c'è nient'altro. L'ambiente è attivo, è la condizione che rende possibile quello che contiene.

Il nero assoluto del display permette alle particelle di esistere come luce pura: ogni punto luminoso emerge dal buio senza competere con altri elementi visivi. Quando le particelle si addensano, la luce si accumula, si sovrappone, produce bagliori che non sarebbero possibili su uno sfondo chiaro. Il contrasto è la condizione della visibilità: senza buio attorno, le particelle perderebbero il margine vibrante che fa apparire dieci punti come cento, e cento punti come una piccola nebulosa.

> **[IMG]** Screenshot del sistema su sfondo nero totale: le particelle come punti di luce in uno spazio senza riferimenti, il nero come spazio fisico e non come assenza di colore.

Il buio della sala in cui si svolge l'installazione prolunga questo principio nello spazio fisico. Non c'è separazione netta tra il nero dello schermo e il nero della stanza: la proiezione sembra emergere dall'oscurità dell'ambiente, non da una superficie delimitata. Questo produce un effetto di profondità e continuità che uno schermo illuminato in una stanza normale non potrebbe avere.

C'è anche una ragione storica per questa scelta. Gran parte dell'arte che lavora con la luce, da James Turrell a Bruce Nauman, usa il buio come condizione. Il buio è una forma di presenza: ricettiva, attenta, capace di accogliere quello che la attraversa. Crea una qualità di percezione diversa rispetto alla luce ordinaria: l'occhio, lasciato senza riferimenti familiari, si abitua a cercare la luce dove c'è, e una volta che ha cominciato a cercarla la trova anche dove è debole, intermittente, quasi infinitesima. È in quel momento che lo sciame, anche disperso, diventa un evento e non un effetto.

---

## 7.2 — Le particelle come luce

Una singola particella, sullo schermo, è quasi niente: un punto bianco di pochi pixel, appena visibile. Ma quando migliaia di particelle si trovano nello stesso punto, la loro luce si somma. Il rendering usa un metodo di miscelazione additivo: invece di coprirsi a vicenda come farebbe della pittura, i colori si sommano come farebbe la luce reale. Due luci sovrapposte producono una luce più intensa, non una mescolanza opaca.

Questo significa che la densità diventa luminosità. Un cluster denso di particelle produce un bagliore che supera di molto la luminosità di qualsiasi particella singola. Le forme che emergono dallo sciame non sono disegnate: sono effetti di luce, prodotti dall'accumulo.

> **[IMG]** Due stati a confronto: sciame disperso (particelle dim, quasi invisibili individualmente) e sciame denso (bagliore intenso, luce accumulata che produce alone luminoso).

C'è qualcosa di fisicamente accurato in questo comportamento: così funziona la luce reale. Una stella singola è un punto nel cielo notturno; una galassia è una nube luminosa. La bellezza che emerge dalla densità ha un'origine nel modo in cui la luce si comporta davvero, non in una scelta puramente estetica. La simulazione, in questo senso, si comporta come una fotografia della realtà fisica: le regole che segue sono le stesse che seguono i fotoni.

---

## 7.3 — Il colore come voce

Ogni partecipante sceglie un colore. Non c'è altro da scegliere: niente nome, niente avatar, niente numero.

La scelta non è casuale. Il colore è il solo identificatore che funziona sia su uno schermo personale da pochi centimetri sia su una proiezione grande come una parete, senza richiedere lettura né interpretazione. Esiste come qualità percettiva pura: chi guarda lo sciame non deve cercare un'etichetta, basta seguire una tinta.

> **[IMG]** Screenshot con più colori distinti visibili nel flusso: tinte individuali riconoscibili all'interno del movimento collettivo, come fili colorati in un tessuto.

Tecnicamente, i colori nel sistema si comportano come la luce, non come la pittura. Il rendering usa un metodo di miscelazione additivo: dove le particelle di due partecipanti si sovrappongono, i loro colori si sommano. Due tinte sovrapposte producono una terza, più luminosa. Una folla di colori tende al bagliore bianco. L'effetto è che nessun colore copre un altro: si mescolano verso qualcosa di comune senza perdere la propria origine.

La scelta del colore è anche il primo gesto che il partecipante compie nel sistema, prima ancora di muovere il joystick. È una scelta puramente estetica, senza conseguenze funzionali: rosso e blu muovono le particelle esattamente allo stesso modo. Ma il colore resta nello sciame per tutta la durata della connessione. È la firma di una presenza percepibile, anche se senza nome: una persona che entra in sala dopo che l'installazione è già cominciata può individuare con un'occhiata la tinta di chi è arrivato per primo, e riconoscerla nei minuti successivi come si riconosce una voce sentita da lontano, senza saperne nient'altro.

---

## 7.4 — L'interfaccia che scompare

Il telefono mostra tre cose: il joystick, il selettore del colore, un punto di stato nell'angolo. Nient'altro.

Nel corso del progetto, questa schermata ha perso elementi. Un testo introduttivo, rimosso. Icone di stato, ridotte a un punto. Un bottone di aiuto, eliminato. A ogni iterazione ci si chiedeva: questo elemento serve all'esperienza, o serve a rassicurare chi ha progettato il sistema che l'utente non si perderà? La seconda risposta ha sempre portato alla rimozione.

> **[IMG]** Schermata del telefono: interfaccia quasi vuota, sfondo scuro, elementi minimi: il meno possibile tra la persona e l'esperienza.

Il costo è misurabile. In alcune sessioni di test, non tutti hanno capito subito dove guardare: alcuni hanno fissato il telefono invece di alzare gli occhi verso lo schermo grande, cercando sull'oggetto piccolo la risposta che stava accadendo su quello grande. Questa latenza, di qualche secondo, raramente di più, è il prezzo del minimalismo.

Non è un problema che si vuole risolvere. Il momento in cui qualcuno smette di guardare il telefono e alza gli occhi verso la proiezione è esattamente il momento in cui l'interfaccia scompare. Non si può accelerarlo con le istruzioni. Bisogna aspettare che accada da solo.
