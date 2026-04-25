# 5. Il sistema

Un sistema è fatto di scelte. Ogni decisione tecnica ha una ragione concettuale dietro, e ogni ragione concettuale ha conseguenze sull'esperienza. Quello che segue non è una documentazione tecnica: è la descrizione di quelle scelte e di perché sono state fatte.

---

## 5.1 — Le particelle

Le particelle sono l'unità fondamentale del sistema. Ogni particella è un agente autonomo: ha una posizione nello spazio, una velocità, una direzione, un colore. Segue regole che determinano come si muove in relazione alle altre particelle, ai campi di forza presenti nella scena, agli input che arrivano dai partecipanti.

Presa singolarmente, una particella è quasi invisibile: un punto luminoso contro il nero. Il sistema ne gestisce decine di migliaia in parallelo, su scheda grafica, dove ogni unità di calcolo processa migliaia di agenti simultaneamente. La complessità non nasce dalla singola particella, ma dalla somma delle interazioni tra di esse. Quando migliaia di agenti si influenzano reciprocamente ogni frammento di secondo, il risultato è qualcosa che nessuno ha progettato: forme che si contraggono e si espandono, correnti che attraversano lo spazio, addensamenti che nascono e si dissolvono.

> **[IMG]** Primo piano di un cluster di particelle ad alta densità — luce che si accumula e produce un bagliore, singoli punti distinguibili ai margini dove la densità decresce.

Il fatto che ogni particella abbia un colore che corrisponde a un partecipante specifico crea una struttura nascosta dentro il sistema: in ogni momento, lo sciame è la sovrapposizione di tanti sotto-sciami individuali, ognuno con la propria tinta. Questa struttura non è sempre visibile, ma è sempre presente. È il modo in cui l'identità individuale sopravvive dentro il corpo collettivo: sempre presente, anche quando non è visibile in superficie.

---

## 5.2 — Il dispositivo remoto

Quando una persona scansiona il codice QR, il proprio telefono diventa parte del sistema. La connessione avviene in tempo reale attraverso un canale WebSocket: ogni movimento del joystick virtuale sullo schermo del telefono produce immediatamente un effetto sulle particelle corrispondenti nella simulazione. Non c'è latenza percepibile. Il gesto e il risultato sono, per l'esperienza di chi partecipa, simultanei.

Il controller è volutamente minimale. C'è un joystick, uno spazio per scegliere il colore, poco altro. Non ci sono spiegazioni, non ci sono tutorial. La prima cosa che quasi tutti fanno è muovere il joystick per vedere cosa succede: scoprono in tempo reale che le particelle rispondono, che il loro colore è visibile nello sciame, che c'è una corrispondenza diretta tra il gesto e il risultato sullo schermo.

> **[IMG]** Schermata del controller su smartphone — joystick virtuale al centro, selettore colore, interfaccia minimalista su sfondo scuro.

Quando una persona lascia il sistema (chiude il browser, si allontana), le sue particelle non spariscono di colpo. Si riorientano lentamente, si mescolano alle altre, perdono gradualmente la direzionalità che aveva il partecipante. Questa dissoluzione lenta è una scelta: rende l'arrivo e la partenza delle persone un evento fluido invece di un cambiamento brusco. Produce la sensazione che il sistema abbia una propria inerzia, una propria memoria del movimento passato.

---

## 5.3 — Il suono

Il microfono del dispositivo che gestisce la simulazione ascolta la stanza in continuazione. Non registra, non analizza il contenuto di ciò che sente: misura il volume ambientale, il livello sonoro complessivo dell'ambiente circostante. Questo valore, elaborato in tempo reale, modifica la luminosità delle particelle: più la stanza è rumorosa, più le particelle si fanno brillanti.

L'implementazione usa un nodo analizzatore del Web Audio API per campionare il segnale del microfono, calcola la potenza media del segnale (RMS) e applica una media mobile esponenziale per smussare le variazioni rapide. Il risultato è un valore continuo tra zero e uno che rappresenta il volume della stanza in quel momento.

> **[IMG]** Due stati della simulazione a confronto: ambiente silenzioso (particelle dim, luce contenuta) e ambiente rumoroso (particelle brillanti, bagliore più intenso e diffuso).

Questa scelta aggiunge al sistema una dimensione che normalmente non viene associata alla grafica computazionale: l'ascolto. Il sistema non aspetta di essere toccato, non aspetta un gesto. Sente. Risponde a quello che succede nella stanza anche quando nessuno sta interagendo direttamente con esso. Il rumore di una conversazione, un momento di risata collettiva, il silenzio improvviso: tutto modifica la luminosità dello sciame. È una forma di consapevolezza ambientale molto primitiva, ma produce la sensazione che il sistema sia attento a ciò che lo circonda, non solo a ciò che gli viene esplicitamente comunicato.

---

## 5.4 — La narrativa automatica

A intervalli, il sistema riceve frammenti di contenuto: parole, frasi brevi, immagini. Questi elementi compaiono su uno strato separato della proiezione, e le particelle vengono attratte verso di essi come se fossero campi di forza fisici. Le parole vengono abitate: le particelle vi si addensano sopra, le contornano, le riempiono di luce. Il testo non è semplicemente sovrapposto alla simulazione: è parte dello spazio in cui le particelle si muovono.

> **[IMG]** Screenshot della simulazione con testo sovrapposto visibile — le particelle che si addensano attorno alle lettere, formando la sagoma delle parole con la propria luce accumulata.

Questo meccanismo consente di introdurre una narrativa nell'esperienza senza che essa sia mai didattica o lineare. I frammenti arrivano come suggestioni, non come spiegazioni. Il pubblico può scegliere di seguire il testo o di ignorarlo, di costruirci un senso sopra o di lasciarlo come sfondo visivo. Le particelle non fanno distinzioni: rispondono alla geometria della parola, non al suo significato.

La gestione di questa narrativa è automatizzata attraverso un sistema di orchestrazione esterno. Questo significa che l'operatore non deve intervenire manualmente durante la sessione: il sistema si muove da solo, seguendo un flusso prestabilito che può essere modificato in anticipo ma non richiede supervisione continua. È anche possibile intervenire in tempo reale per alterare il flusso narrativo in risposta a quello che sta succedendo nella stanza, se si vuole rendere l'esperienza più reattiva al contesto specifico di quel pubblico.
