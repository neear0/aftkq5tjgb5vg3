<?php
/**
 * Plugin Name:       ULTRA PEPTIDY — množstevné ceny a cenník
 * Description:       Pridáva cenu za kus od 3 kusov (stĺpec „3+ KS" z tlačeného cenníka), aplikuje ju v košíku a poskytuje shortcode [up_cennik] na kompletnú cenníkovú tabuľku.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            ULTRA PEPTIDY
 * Text Domain:       up-cennik
 *
 * ------------------------------------------------------------------------
 * PREČO VLASTNÝ PLUGIN A NIE HOTOVÝ
 * ------------------------------------------------------------------------
 * WooCommerce nevie množstevné ceny natívne. Hotové pluginy na to vedia
 * omnoho viac, než potrebujeme (cenové role, tabuľky pravidiel, B2B ceny),
 * a každý z nich je ďalšia vec, ktorá sa pri update rozbije a ktorú treba
 * bezpečnostne sledovať. Náš prípad je jedno pravidlo: od 3 kusov tej istej
 * položky platí nižšia cena za kus. To je 150 riadkov, nie 15 000.
 *
 * Cena sa ukladá do meta poľa `_up_tier3_price` — to isté pole plní CSV
 * import zo scripts/export-woocommerce.mjs, takže katalóg sa dá nahrať
 * jedným importom aj s množstevnými cenami.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit; // priamy prístup k súboru
}

const UP_TIER_META = '_up_tier3_price';
const UP_TIER_QTY  = 3;

/* =========================================================================
   1) Pole v administrácii produktu
   ========================================================================= */

/**
 * Pole pridávame do záložky „Všeobecné" hneď za bežnú a akciovú cenu, aby
 * ho obsluha našla tam, kde už ceny zadáva.
 */
add_action('woocommerce_product_options_pricing', static function (): void {
    woocommerce_wp_text_input([
        'id'          => UP_TIER_META,
        'label'       => __('Cena za kus od 3 ks', 'up-cennik') . ' (' . get_woocommerce_currency_symbol() . ')',
        'desc_tip'    => true,
        'description' => __(
            'Zvýhodnená cena za jeden kus, ktorá platí pri objednávke 3 a viac kusov tejto položky. '
            . 'Nechaj prázdne, ak pre túto položku množstevná cena neplatí — v cenníku sa potom zobrazí pomlčka.',
            'up-cennik'
        ),
        'data_type'   => 'price',
    ]);
});

add_action('woocommerce_process_product_meta', static function (int $post_id): void {
    // Nonce overuje samotný WooCommerce pred spustením tohto hooku.
    $raw = isset($_POST[UP_TIER_META]) ? wc_clean(wp_unslash($_POST[UP_TIER_META])) : '';
    $product = wc_get_product($post_id);
    if (!$product) {
        return;
    }

    if ($raw === '') {
        $product->delete_meta_data(UP_TIER_META);
        $product->save();
        return;
    }

    $tier    = (float) wc_format_decimal($raw);
    $regular = (float) $product->get_regular_price();

    // Chyba v prospech obsluhy: radšej pole nezapíš a povedz to, než ticho
    // uložiť cenu, ktorá je vyššia než základná.
    if ($regular > 0 && $tier >= $regular) {
        $product->delete_meta_data(UP_TIER_META);
        $product->save();
        set_transient('up_tier_error_' . $post_id, 1, 60);
        return;
    }

    $product->update_meta_data(UP_TIER_META, wc_format_decimal($tier));
    $product->save();
}, 10, 1);

/**
 * To isté pole pre varianty. Bez tohto by 7 produktov s výberom gramáže
 * nemalo v administrácii kde množstevnú cenu zadať — pole
 * `woocommerce_product_options_pricing` sa pri variantoch nezobrazuje.
 */
add_action('woocommerce_variation_options_pricing', static function (int $loop, array $data, WP_Post $variation): void {
    woocommerce_wp_text_input([
        'id'            => UP_TIER_META . '_' . $loop,
        'name'          => UP_TIER_META . '[' . $loop . ']',
        'value'         => get_post_meta($variation->ID, UP_TIER_META, true),
        'label'         => __('Cena za kus od 3 ks', 'up-cennik') . ' (' . get_woocommerce_currency_symbol() . ')',
        'desc_tip'      => true,
        'description'   => __('Platí pri 3 a viac kusoch tejto gramáže. Nechaj prázdne, ak neplatí.', 'up-cennik'),
        'data_type'     => 'price',
        'wrapper_class' => 'form-row form-row-full',
    ]);
}, 10, 3);

add_action('woocommerce_save_product_variation', static function (int $variation_id, int $loop): void {
    $raw = isset($_POST[UP_TIER_META][$loop])
        ? wc_clean(wp_unslash($_POST[UP_TIER_META][$loop]))
        : '';

    if ($raw === '') {
        delete_post_meta($variation_id, UP_TIER_META);
        return;
    }

    $tier    = (float) wc_format_decimal($raw);
    $variant = wc_get_product($variation_id);
    $regular = $variant ? (float) $variant->get_regular_price() : 0.0;

    if ($regular > 0 && $tier >= $regular) {
        delete_post_meta($variation_id, UP_TIER_META);
        set_transient('up_tier_error_' . $variation_id, 1, 60);
        return;
    }

    update_post_meta($variation_id, UP_TIER_META, wc_format_decimal($tier));
}, 10, 2);

add_action('admin_notices', static function (): void {
    $screen = get_current_screen();
    if (!$screen || $screen->id !== 'product') {
        return;
    }
    $id = get_the_ID();
    if ($id && get_transient('up_tier_error_' . $id)) {
        delete_transient('up_tier_error_' . $id);
        printf(
            '<div class="notice notice-error is-dismissible"><p>%s</p></div>',
            esc_html__(
                'Cena od 3 ks musí byť nižšia ako bežná cena. Pole nebolo uložené.',
                'up-cennik'
            )
        );
    }
});

/* =========================================================================
   2) Aplikovanie ceny v košíku
   ========================================================================= */

/**
 * Vráti množstevnú cenu produktu alebo null.
 */
function up_tier_price(WC_Product $product): ?float
{
    // U variantu berieme pole z variantu, a ak ho nemá, z rodiča.
    $raw = $product->get_meta(UP_TIER_META);
    if ($raw === '' && $product->is_type('variation')) {
        $parent = wc_get_product($product->get_parent_id());
        $raw = $parent ? $parent->get_meta(UP_TIER_META) : '';
    }
    if ($raw === '' || $raw === null) {
        return null;
    }
    $tier = (float) $raw;
    return $tier > 0 ? $tier : null;
}

/**
 * Hook beží pri každom prepočte košíka, aj viackrát za request. Preto
 * pracujeme vždy z pôvodných dát produktu, nie z už upravenej ceny.
 */
add_action('woocommerce_before_calculate_totals', static function (WC_Cart $cart): void {
    if (is_admin() && !wp_doing_ajax()) {
        return;
    }
    if (did_action('woocommerce_before_calculate_totals') >= 2) {
        return;
    }

    foreach ($cart->get_cart() as $item) {
        /** @var WC_Product $product */
        $product = $item['data'];
        $tier = up_tier_price($product);
        if ($tier === null || (int) $item['quantity'] < UP_TIER_QTY) {
            continue;
        }
        $product->set_price($tier);
    }
}, 20, 1);

/* =========================================================================
   3) Zobrazenie na produkte a vo výpise
   ========================================================================= */

add_action('woocommerce_single_product_summary', static function (): void {
    global $product;
    if (!$product instanceof WC_Product) {
        return;
    }
    $tier = up_tier_price($product);
    if ($tier === null) {
        return;
    }
    $saving = ((float) $product->get_price() - $tier) * UP_TIER_QTY;

    echo '<table class="up-tiers"><tbody>';
    printf(
        '<tr><th>%s</th><td>%s</td></tr>',
        esc_html__('1 ks', 'up-cennik'),
        wp_kses_post(wc_price($product->get_price()))
    );
    printf(
        '<tr class="up-tiers__q"><th>%s <small>%s</small></th><td>%s</td></tr>',
        esc_html__('3+ ks', 'up-cennik'),
        esc_html__('za kus', 'up-cennik'),
        wp_kses_post(wc_price($tier))
    );
    echo '</tbody></table>';

    if ($saving > 0) {
        printf(
            '<p class="up-tiers__save">%s</p>',
            esc_html(sprintf(
                /* translators: %s je suma */
                __('Pri 3 kusoch ušetríš %s.', 'up-cennik'),
                wp_strip_all_tags(wc_price($saving))
            ))
        );
    }
}, 11);

add_action('woocommerce_after_shop_loop_item_title', static function (): void {
    global $product;
    if (!$product instanceof WC_Product) {
        return;
    }
    $tier = up_tier_price($product);
    if ($tier === null) {
        return;
    }
    printf(
        '<span class="up-tiers__loop">%s %s</span>',
        esc_html__('3+ ks za kus', 'up-cennik'),
        wp_kses_post(wc_price($tier))
    );
}, 11);

/* =========================================================================
   4) Shortcode [up_cennik] — kompletná cenníková tabuľka
   ========================================================================= */

/**
 * Použitie:
 *   [up_cennik]                      všetky kategórie
 *   [up_cennik kategorie="krasa"]    len vybrané, oddelené čiarkou
 *
 * Výsledok sa cachuje na hodinu; pri zmene ceny sa cache zhodí sama
 * (viď invalidáciu nižšie).
 */
add_shortcode('up_cennik', static function ($atts): string {
    $atts = shortcode_atts(['kategorie' => ''], $atts, 'up_cennik');
    $key  = 'up_cennik_' . md5((string) $atts['kategorie']);

    $cached = get_transient($key);
    if (is_string($cached) && $cached !== '') {
        return $cached;
    }

    $terms = get_terms([
        'taxonomy'   => 'product_cat',
        'hide_empty' => true,
        'slug'       => $atts['kategorie'] !== ''
            ? array_map('sanitize_title', array_map('trim', explode(',', (string) $atts['kategorie'])))
            : '',
        'orderby'    => 'term_order',
    ]);
    if (is_wp_error($terms) || !$terms) {
        return '';
    }

    $out = '<div class="up-pricelist">';
    foreach ($terms as $term) {
        $q = new WP_Query([
            'post_type'      => 'product',
            'posts_per_page' => -1,
            'orderby'        => 'menu_order title',
            'order'          => 'ASC',
            'no_found_rows'  => true,
            'tax_query'      => [[
                'taxonomy' => 'product_cat',
                'field'    => 'term_id',
                'terms'    => $term->term_id,
            ]],
        ]);
        if (!$q->have_posts()) {
            continue;
        }

        $out .= '<div class="up-pricelist__group">';
        $out .= '<h3>' . esc_html($term->name) . '</h3>';
        $out .= '<table><thead><tr>'
              . '<th>' . esc_html__('Produkt', 'up-cennik') . '</th>'
              . '<th>' . esc_html__('1 ks', 'up-cennik') . '</th>'
              . '<th>' . esc_html__('3+ ks za kus', 'up-cennik') . '</th>'
              . '</tr></thead><tbody>';

        while ($q->have_posts()) {
            $q->the_post();
            $product = wc_get_product(get_the_ID());
            if (!$product || !$product->is_visible()) {
                continue;
            }
            $tier = up_tier_price($product);
            $out .= '<tr>'
                  . '<td><a href="' . esc_url(get_permalink()) . '">' . esc_html($product->get_name()) . '</a></td>'
                  . '<td class="up-1ks">' . wp_kses_post(wc_price($product->get_price())) . '</td>'
                  . '<td class="' . ($tier !== null ? 'up-3ks' : 'up-none') . '">'
                  . ($tier !== null ? wp_kses_post(wc_price($tier)) : '–')
                  . '</td></tr>';
        }
        wp_reset_postdata();

        $out .= '</tbody></table></div>';
    }
    $out .= '</div>';

    set_transient($key, $out, HOUR_IN_SECONDS);
    return $out;
});

/**
 * Cenník je cachovaný, takže po zmene produktu ho treba zhodiť — inak by
 * obsluha zmenila cenu a hodinu by sa čudovala, prečo sa neprejavila.
 */
add_action('woocommerce_update_product', 'up_cennik_flush');
add_action('woocommerce_new_product', 'up_cennik_flush');
add_action('delete_post', 'up_cennik_flush');
function up_cennik_flush(): void
{
    global $wpdb;
    $wpdb->query(
        "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_up_cennik_%'
         OR option_name LIKE '_transient_timeout_up_cennik_%'"
    );
}

/* =========================================================================
   5) Štýly
   ========================================================================= */

add_action('wp_enqueue_scripts', static function (): void {
    $css = '
.up-tiers{width:auto;margin:0 0 12px;border-collapse:collapse;font-variant-numeric:tabular-nums}
.up-tiers th{padding:4px 18px 4px 0;text-align:left;font:500 .75rem/1.4 var(--up-font-mono,monospace);
  letter-spacing:.1em;text-transform:uppercase;color:var(--up-text-mute,#6E7488)}
.up-tiers th small{display:block;font-size:.625rem;color:#565B6D}
.up-tiers td{padding:4px 0;font:500 1.1875rem/1 var(--up-font-mono,monospace);color:#fff}
.up-tiers__q td{color:var(--up-price-tier,#22D3EE)}
.up-tiers__save{margin:0 0 16px;font-size:.875rem;color:var(--up-ok,#34D399)}
.up-tiers__loop{display:block;font:500 .75rem/1.6 var(--up-font-mono,monospace);
  color:var(--up-price-tier,#22D3EE)}
.up-pricelist{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr))}
.up-pricelist__group{padding:24px;background:var(--up-ink-2,#101014)}
.up-pricelist__group h3{margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid var(--up-hairline,#24242E);
  font:italic 700 1rem/1.2 var(--up-font-display,sans-serif);text-transform:uppercase;
  letter-spacing:.05em;color:var(--up-purple-glow,#C084FC)}
.up-pricelist table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.up-pricelist th{padding:0 0 8px;text-align:right;font:500 .75rem/1.3 var(--up-font-mono,monospace);
  letter-spacing:.1em;text-transform:uppercase;color:var(--up-text-mute,#6E7488)}
.up-pricelist th:first-child{text-align:left}
.up-pricelist td{padding:7px 0;border-top:1px solid rgba(36,36,46,.6);text-align:right;
  font:400 .875rem/1.4 var(--up-font-mono,monospace)}
.up-pricelist td:first-child{text-align:left;font-family:var(--up-font-body,sans-serif)}
.up-pricelist .up-1ks{color:#fff}
.up-pricelist .up-3ks{color:var(--up-price-tier,#22D3EE)}
.up-pricelist .up-none{color:#4A4E5E}
';
    wp_register_style('up-cennik', false, [], '1.0.0');
    wp_enqueue_style('up-cennik');
    wp_add_inline_style('up-cennik', $css);
});

/* =========================================================================
   6) Kompatibilita s HPOS (nové úložisko objednávok WooCommerce)
   ========================================================================= */

add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables',
            __FILE__,
            true
        );
    }
});
