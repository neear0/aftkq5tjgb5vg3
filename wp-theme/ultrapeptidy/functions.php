<?php
/**
 * ULTRA PEPTIDY — child téma Storefrontu.
 *
 * Zámerne malý súbor. Robí štyri veci:
 *   1) načíta naše CSS až za rodičom
 *   2) odstráni z WordPressu a Storefrontu to, čo na 25 workeroch len brzdí
 *   3) prispôsobí výpis produktov (počet v riadku, bez bočného panela)
 *   4) doplní na produkt gramáž, šaržu a čistotu z meta polí
 *
 * @package ultrapeptidy
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/* =========================================================================
   1) Štýly
   ========================================================================= */

add_action('wp_enqueue_scripts', static function (): void {
    $theme = wp_get_theme();
    $ver   = $theme->get('Version') ?: '1.0.0';

    // Rodič sa načíta sám; my sa naň len zavesíme, aby naše prepisy vyhrali.
    wp_enqueue_style(
        'ultrapeptidy',
        get_stylesheet_directory_uri() . '/assets/css/theme.css',
        ['storefront-style'],
        $ver
    );

    // Fonty sú systémové — žiadny externý request. Google Fonts CDN je
    // v EÚ problém s GDPR a navyše pomalší o extra DNS + TLS handshake.
}, 20);

/* =========================================================================
   2) Odtučnenie
   ========================================================================= */

add_action('init', static function (): void {
    // Emoji skript a jeho detekcia sa načítavajú na každej stránke
    // a nepoužívame ich.
    remove_action('wp_head', 'print_emoji_detection_script', 7);
    remove_action('wp_print_styles', 'print_emoji_styles');
    remove_action('admin_print_scripts', 'print_emoji_detection_script');
    remove_action('admin_print_styles', 'print_emoji_styles');

    // oEmbed discovery a wlwmanifest nepotrebujeme
    remove_action('wp_head', 'wp_oembed_add_discovery_links');
    remove_action('wp_head', 'wp_oembed_add_host_js');
    remove_action('wp_head', 'wlwmanifest_link');
    remove_action('wp_head', 'rsd_link');
    remove_action('wp_head', 'wp_generator');
});

/**
 * Blokové štýly Gutenbergu na e-shope nepotrebujeme a pridávajú ~60 kB CSS.
 * Ak by sa niekedy začali používať bloky v obsahu stránok, tento hook odstráň.
 */
add_action('wp_enqueue_scripts', static function (): void {
    if (!is_admin()) {
        wp_dequeue_style('wp-block-library');
        wp_dequeue_style('wp-block-library-theme');
        wp_dequeue_style('classic-theme-styles');
        wp_dequeue_style('global-styles');
    }
}, 100);

/**
 * WP-Cron pri každom requeste je na shared hostingu s 25 workermi zlý
 * kompromis. Vypína sa v wp-config.php cez DISABLE_WP_CRON a namiesto neho
 * beží reálny cron z WebAdminu — tu len upozorníme v administrácii, keby
 * to niekto zabudol nastaviť.
 */
add_action('admin_notices', static function (): void {
    if (!current_user_can('manage_options')) {
        return;
    }
    if (!defined('DISABLE_WP_CRON') || !DISABLE_WP_CRON) {
        printf(
            '<div class="notice notice-warning"><p><strong>%s</strong> %s</p></div>',
            esc_html__('WP-Cron je zapnutý.', 'ultrapeptidy'),
            esc_html__(
                'Na shared hostingu spomaľuje každé načítanie stránky. Do wp-config.php pridaj '
                . "define('DISABLE_WP_CRON', true); a v WebAdmine Websupportu nastav cron na "
                . 'wp-cron.php raz za 5 minút.',
                'ultrapeptidy'
            )
        );
    }
});

/* =========================================================================
   3) Výpis produktov
   ========================================================================= */

// Katalóg je úzky (23 produktov), takže 4 v riadku a všetko na jednej strane.
add_filter('loop_shop_columns', static fn (): int => 4, 20);
add_filter('loop_shop_per_page', static fn (): int => 48, 20);

// Bočný panel na e-shope len uberá miesto produktom.
add_action('init', static function (): void {
    remove_action('storefront_sidebar', 'storefront_get_sidebar', 10);
});
add_filter('body_class', static function (array $classes): array {
    $classes[] = 'up-no-sidebar';
    return $classes;
});

// Storefront pridáva na archív nadpis a breadcrumbs duplicitne k našim.
add_action('init', static function (): void {
    remove_action('storefront_before_content', 'woocommerce_breadcrumb', 10);
});

/* =========================================================================
   4) Gramáž, šarža a čistota na produkte
   ========================================================================= */

/**
 * Meta polia plní CSV import (scripts/export-woocommerce.mjs) a plugin
 * ultrapeptidy-cennik. Tu ich len zobrazujeme pod názvom produktu.
 */
add_action('woocommerce_single_product_summary', static function (): void {
    global $product;
    if (!$product instanceof WC_Product) {
        return;
    }

    $rows = [];

    $batch = $product->get_meta('_up_batch');
    if ($batch !== '') {
        $rows[] = [__('Šarža', 'ultrapeptidy'), $batch];
    }

    $purity = $product->get_meta('_up_purity');
    if ($purity !== '') {
        $rows[] = [__('Čistota', 'ultrapeptidy'), str_replace('.', ',', (string) $purity) . ' %'];
    }

    if (!$rows) {
        return;
    }

    echo '<ul class="up-meta">';
    foreach ($rows as [$label, $value]) {
        printf(
            '<li><span>%s</span> <strong>%s</strong></li>',
            esc_html($label),
            esc_html((string) $value)
        );
    }
    echo '</ul>';
}, 6);

/**
 * Pri variabilných produktoch (Reta, Tesamorelin, …) sa šarža a čistota
 * líšia podľa gramáže. WooCommerce pošle dáta variantu v JSON-e, tak sa
 * na to navesíme a hodnoty prepíšeme.
 */
add_filter('woocommerce_available_variation', static function (array $data, $product, $variation): array {
    $data['up_batch']  = (string) $variation->get_meta('_up_batch');
    $data['up_purity'] = (string) $variation->get_meta('_up_purity');
    return $data;
}, 10, 3);

add_action('wp_footer', static function (): void {
    if (!function_exists('is_product') || !is_product()) {
        return;
    }
    ?>
    <script>
    /* Prepnutie gramáže prepíše šaržu a čistotu. WooCommerce vystavuje
       zvolený variant v evente found_variation. */
    (function () {
      var form = document.querySelector('form.variations_form');
      if (!form || !window.jQuery) return;
      var meta = document.querySelector('.up-meta');
      if (!meta) return;

      var set = function (label, value) {
        var items = meta.querySelectorAll('li');
        for (var i = 0; i < items.length; i++) {
          var l = items[i].querySelector('span');
          if (l && l.textContent.trim() === label) {
            var s = items[i].querySelector('strong');
            if (s) s.textContent = value;
            items[i].hidden = !value;
            return;
          }
        }
      };

      window.jQuery(form).on('found_variation', function (e, v) {
        if (v.up_batch !== undefined) set('Šarža', v.up_batch || '—');
        if (v.up_purity !== undefined) {
          set('Čistota', v.up_purity ? String(v.up_purity).replace('.', ',') + ' %' : '');
        }
      });
    })();
    </script>
    <?php
}, 30);

/* =========================================================================
   5) Povinný RUO disclaimer v pätičke
   ========================================================================= */

/**
 * Disclaimer nesmie závisieť od toho, či ho niekto vloží do widgetu —
 * je to právna náležitosť, tak je v kóde témy.
 */
add_action('storefront_footer', static function (): void {
    ?>
    <div class="up-ruo">
      <div class="col-full">
        <p>
          <strong><?php esc_html_e('FOR RESEARCH USE ONLY.', 'ultrapeptidy'); ?></strong>
          <?php esc_html_e(
              'Všetky produkty v tomto katalógu sú referenčné látky určené výhradne na laboratórne '
              . 'a výskumné použitie. Nie sú liekmi, výživovými doplnkami, kozmetikou ani '
              . 'zdravotníckymi pomôckami a nie sú určené na diagnostiku, prevenciu, liečbu ani '
              . 'na podávanie ľuďom či zvieratám. Neposkytujeme dávkovanie ani zdravotné '
              . 'odporúčania. Nákup je možný len osobám nad 18 rokov.',
              'ultrapeptidy'
          ); ?>
        </p>
      </div>
    </div>
    <?php
}, 25);
