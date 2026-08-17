<?php
/**
 * ULTRA PEPTIDY — nastavenie množstevných cien "3+ KS (za kus)".
 *
 * PrestaShop CSV import NEUMOŽŇUJE importovať specific prices, preto tento skript.
 * Číta data/produkty.csv, páruje produkty podľa `reference` a vytvára
 * SpecificPrice s from_quantity = 3.
 *
 * Použitie (SSH):
 *   cd ~/ultrapeptidy.sk
 *   php8.2 _cli/set-specific-prices.php --csv=/home/USER/data/produkty.csv --dry-run
 *   php8.2 _cli/set-specific-prices.php --csv=/home/USER/data/produkty.csv
 *
 * Skript je idempotentný: existujúce 3+ pravidlá pre daný produkt najprv zmaže.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

require dirname(__DIR__) . '/config/config.inc.php';

const TIER_QTY = 3;

$opts   = getopt('', ['csv:', 'dry-run', 'shop::']);
$csv    = $opts['csv'] ?? null;
$dryRun = array_key_exists('dry-run', $opts);
$idShop = (int) ($opts['shop'] ?? Configuration::get('PS_SHOP_DEFAULT'));

if (!$csv || !is_readable($csv)) {
    exit("Chyba: --csv=<cesta> je povinné a súbor musí byť čitateľný.\n");
}

$fh = fopen($csv, 'rb');
if ($fh === false) {
    exit("Chyba: nepodarilo sa otvoriť CSV.\n");
}

$header = fgetcsv($fh, 0, ';');
if ($header === false) {
    fclose($fh);
    exit("Chyba: prázdne CSV.\n");
}
$header = array_map(static fn($h) => trim((string) $h, " \t\n\r\0\x0B\xEF\xBB\xBF"), $header);
$col    = array_flip($header);

foreach (['reference', 'tier3_discount_gross_eur'] as $required) {
    if (!isset($col[$required])) {
        fclose($fh);
        exit("Chyba: v CSV chýba stĺpec '$required'.\n");
    }
}

$db       = Db::getInstance();
$created  = 0;
$skipped  = 0;
$missing  = [];
$line     = 1;

echo $dryRun ? "── DRY RUN (nič sa nezapíše) ──\n" : "── ZÁPIS ──\n";

while (($row = fgetcsv($fh, 0, ';')) !== false) {
    $line++;
    if ($row === [null] || count($row) < 2) {
        continue; // prázdny riadok
    }

    $reference = trim((string) ($row[$col['reference']] ?? ''));
    $discount  = trim((string) ($row[$col['tier3_discount_gross_eur']] ?? ''));

    if ($reference === '') {
        continue;
    }

    // produkty bez 3+ ceny (KPV, GHRP-6, Bac Water) majú prázdny stĺpec — v cenníku "–"
    if ($discount === '') {
        $skipped++;
        printf("  ·  %-12s bez 3+ ceny (v cenníku „–\")\n", $reference);
        continue;
    }

    $discount = (float) str_replace(',', '.', $discount);
    if ($discount <= 0) {
        $skipped++;
        continue;
    }

    $idProduct = (int) $db->getValue(
        'SELECT id_product FROM `' . _DB_PREFIX_ . 'product`
         WHERE reference = "' . pSQL($reference) . '"'
    );

    if (!$idProduct) {
        $missing[] = $reference;
        continue;
    }

    // idempotencia — zmaž staré 3+ pravidlá pre tento produkt
    $existing = $db->executeS(
        'SELECT id_specific_price FROM `' . _DB_PREFIX_ . 'specific_price`
         WHERE id_product = ' . $idProduct . '
           AND from_quantity = ' . TIER_QTY . '
           AND id_cart = 0 AND id_specific_price_rule = 0'
    );
    foreach ($existing ?: [] as $old) {
        if (!$dryRun) {
            (new SpecificPrice((int) $old['id_specific_price']))->delete();
        }
    }

    $sp                         = new SpecificPrice();
    $sp->id_product             = $idProduct;
    $sp->id_product_attribute   = 0;      // 0 = platí pre všetky kombinácie
    $sp->id_shop                = $idShop;
    $sp->id_shop_group          = 0;
    $sp->id_currency            = 0;      // 0 = všetky
    $sp->id_country             = 0;
    $sp->id_group               = 0;
    $sp->id_customer            = 0;
    $sp->from_quantity          = TIER_QTY;
    $sp->price                  = -1.0;   // -1 = použi základnú cenu produktu
    $sp->reduction              = $discount;
    $sp->reduction_tax          = 1;      // hodnota JE s DPH (ceny v cenníku sú s DPH)
    $sp->reduction_type         = 'amount';
    $sp->from                   = '0000-00-00 00:00:00';
    $sp->to                     = '0000-00-00 00:00:00';

    if ($dryRun) {
        printf("  +  %-12s (#%d) → −%.2f € od %d ks\n", $reference, $idProduct, $discount, TIER_QTY);
        $created++;
        continue;
    }

    if ($sp->add()) {
        $created++;
        printf("  ✓  %-12s (#%d) → −%.2f € od %d ks\n", $reference, $idProduct, $discount, TIER_QTY);
    } else {
        fwrite(STDERR, sprintf("  ✗  %-12s ZLYHALO\n", $reference));
    }
}
fclose($fh);

if (!$dryRun && $created > 0) {
    Product::flushPriceCache();
    Cache::clean('*');
}

echo "\n────────────────────────────────────────\n";
printf("Vytvorené pravidlá : %d\n", $created);
printf("Bez 3+ ceny        : %d\n", $skipped);

if ($missing) {
    printf("\n⚠ Nenájdené referencie (%d) — najprv naimportuj produkty:\n   %s\n",
        count($missing), implode(', ', $missing));
    exit(1);
}

echo "Hotovo.\n";
exit(0);
