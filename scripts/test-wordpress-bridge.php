<?php
// Integration checks against an isolated WordPress + WP Recipe Maker installation.
// Usage: php scripts/test-wordpress-bridge.php <disposable-wordpress-directory>
$root = realpath($argv[1] ?? '');
if (!$root || !is_file($root . '/wp-load.php') || strpos(str_replace('\\', '/', $root), '/.test-build/wp-integration/') === false) { throw new RuntimeException('Use the disposable .test-build/wp-integration WordPress installation.'); }
define('WP_INSTALLING', true);
$_SERVER['HTTP_HOST'] = '127.0.0.1'; $_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
add_filter('pre_wp_mail', '__return_false');
if (!is_blog_installed()) { wp_install('Disposable bridge test', 'bridge-test-admin', 'test@example.invalid', false, '', bin2hex(random_bytes(24))); }
wp_set_current_user(get_user_by('login', 'bridge-test-admin')->ID);
require_once $root . '/wp-content/plugins/wp-recipe-maker/wp-recipe-maker.php';
// Plugin loaded after init in this CLI process: register its post type explicitly.
WPRM_Post_Type::register_post_type();
WPRM_Blocks::register_recipe_block();
WPRM_Taxonomies::register_taxonomies();
WPRM_Taxonomies::insert_default_taxonomy_terms();
WPRM_Changelog_Database::check_database_version();
require dirname(__DIR__) . '/wordpress/recipe-intelligence-bridge/recipe-intelligence-bridge.php';
$server = rest_get_server();
function check($ok, $label) { if (!$ok) { throw new RuntimeException($label); } echo "PASS $label\n"; }
function request_bridge($method, $route, $data = null) {
    $r = new WP_REST_Request($method, '/recipe-intelligence/v1/' . $route);
    if ($data !== null) { $r->set_header('content-type', 'application/json'); $r->set_body(wp_json_encode($data)); }
    return rest_do_request($r);
}
update_option(Recipe_Intelligence_Bridge::OPTION, 'builtin');
$profile = request_bridge('GET', 'profile')->get_data();
check($profile['ready'] && $profile['recipeCard'] === 'builtin', 'default card sync');
// Two local fixture photos, in reversed attachment-ID order, verify article order wins.
$media = [];
foreach (['featured-red.jpg', 'featured-blue.jpg'] as $filename) {
    $bytes = file_get_contents(dirname($root) . '/' . $filename);
    if ($filename === 'featured-blue.jpg') {
        $image = imagecreatefromstring($bytes);
        ob_start(); imagewebp($image, null, IMG_WEBP_LOSSLESS); $bytes = ob_get_clean();
        $r = new WP_REST_Request('POST', '/wp/v2/media');
        $r->set_header('content-type', 'image/webp');
        $r->set_header('content-disposition', 'attachment; filename="featured-blue.webp"');
        $r->set_body($bytes);
        $response = rest_do_request($r); $data = $response->get_data();
        check($response->get_status() === 201, 'WebP accepted by actual WordPress media REST endpoint');
        check($data['mime_type'] === 'image/webp' && str_ends_with($data['source_url'], '.webp'), 'WebP MIME and filename retained');
        check(file_get_contents(get_attached_file($data['id'])) === $bytes, 'uploaded WebP master bytes unchanged');
        $media[] = $data['id'];
        continue;
    }
    $upload = wp_upload_bits($filename, null, $bytes);
    check(!$upload['error'], 'fixture photo uploaded');
    $attachment = wp_insert_attachment(['post_mime_type' => 'image/jpeg', 'post_title' => $filename, 'post_status' => 'inherit', 'post_author' => get_current_user_id()], $upload['file'], 0, true);
    check(!is_wp_error($attachment), 'fixture attachment created');
    wp_update_attachment_metadata($attachment, wp_generate_attachment_metadata($attachment, $upload['file']));
    $media[] = $attachment;
}
$media = array_reverse($media);
$image_content = '<p>Safe article.</p><img src="' . esc_url(wp_get_attachment_url($media[0])) . '"><img src="' . esc_url(wp_get_attachment_url($media[1])) . '"><!--ri-recipe-card-->';
$payload = ['exportId' => hash('sha256', random_bytes(20)), 'profileRevision' => $profile['revision'], 'recipeCard' => 'builtin', 'title' => 'Soup test', 'slug' => 'soup-test', 'excerpt' => 'A test.', 'content' => '<p>Safe article.</p><!--ri-recipe-card-->', 'mediaIds' => [], 'status' => 'draft', 'recipe' => ['name' => 'Soup', 'description' => 'Warm soup.', 'recipeIngredient' => ['1/2 tsp salt', '750 ml water'], 'instructions' => ['Simmer for 20 minutes.'], 'recipeYield' => '4 servings', 'cookTime' => 'PT20M']];
$payload['mediaIds'] = $media; $payload['content'] = $image_content;
$draft = request_bridge('POST', 'exports', $payload); check($draft->get_status() === 200, 'draft endpoint');
$saved = $draft->get_data(); check(get_post_status($saved['postId']) === 'draft', 'draft stays private');
check(get_post_thumbnail_id($saved['postId']) === $media[0], 'first article image is the draft featured image');
check(strpos(get_post($saved['postId'])->post_content, '[ri_recipe id=') !== false, 'builtin card embedded');
check(strpos(do_shortcode(get_post($saved['postId'])->post_content), '1/2 tsp salt') !== false, 'card preserves quantities');
$repeat = request_bridge('POST', 'exports', $payload)->get_data(); check($repeat['postId'] === $saved['postId'], 'idempotent post');
$payload['status'] = 'publish'; check(request_bridge('POST', 'exports', $payload)->get_status() === 403, 'live requires confirmation');
$payload['confirmPublish'] = true; check(request_bridge('POST', 'exports', $payload)->get_data()['status'] === 'publish', 'explicit live publishes same post');
check(get_post_thumbnail_id($saved['postId']) === $media[0], 'featured image retained when publishing');
$payload['content'] = '<p>Changed</p><!--ri-recipe-card-->'; check(request_bridge('POST', 'exports', $payload)->get_status() === 409, 'payload conflict cannot overwrite');
update_option(Recipe_Intelligence_Bridge::OPTION, 'wprm');
$profile = request_bridge('GET', 'profile')->get_data(); check($profile['ready'], 'native adapter detected');
$payload['exportId'] = hash('sha256', random_bytes(20)); $payload['profileRevision'] = $profile['revision']; $payload['recipeCard'] = 'wprm'; $payload['status'] = 'draft';
$payload['content'] = $image_content;
$response = request_bridge('POST', 'exports', $payload); check($response->get_status() === 200, 'WP Recipe Maker native creation: ' . wp_json_encode($response->get_data()));
$native = $response->get_data();
check(get_post_type($native['recipeId']) === 'wprm_recipe', 'native editable recipe record');
check(get_post_thumbnail_id($native['postId']) === $media[0], 'first article image is featured with WP Recipe Maker');
check(get_post_thumbnail_id($native['recipeId']) === $media[0], 'recipe card uses the same first image');
check(strpos(get_post($native['postId'])->post_content, '[wprm-recipe id=') !== false || strpos(get_post($native['postId'])->post_content, '<!--WPRM Recipe ' . $native['recipeId'] . '-->') !== false, 'native recipe embedded');
$recipe = WPRM_Recipe_Manager::get_recipe($native['recipeId']);
check($recipe->ingredients()[0]['ingredients'][0]['name'] === '1/2 tsp salt', 'native ingredients preserve exact quantities');
check(intval($recipe->cook_time()) === 20, 'native time mapping');
check(get_post_meta($native['recipeId'], 'wprm_parent_post_id', true) == $native['postId'], 'native parent association');
$payload['status'] = 'publish'; $payload['confirmPublish'] = true;
check(request_bridge('POST', 'exports', $payload)->get_data()['status'] === 'publish', 'native draft publishes');
check(get_post_status($native['recipeId']) === 'publish', 'native recipe publication follows its parent');
check(strpos(get_post($native['postId'])->post_content, '<!-- wp:wp-recipe-maker/recipe ') !== false, 'Gutenberg native card block');
// Create another private draft for the access test.
$payload['exportId'] = hash('sha256', random_bytes(20)); $payload['status'] = 'draft';
$private = request_bridge('POST', 'exports', $payload)->get_data();
wp_set_current_user(0); check(request_bridge('GET', 'profile')->get_status() === 403, 'anonymous access denied');
check(Recipe_Intelligence_Bridge::card(['id' => $private['postId']]) === '', 'draft recipe not leaked');
echo "WordPress integration checks passed. No external sites or paid providers were used.\n";
