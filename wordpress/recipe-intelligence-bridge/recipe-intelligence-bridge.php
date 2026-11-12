<?php
/**
 * Plugin Name: Recipe Intelligence Bridge
 * Description: Connect Recipe Intelligence, choose your default recipe card, and receive articles as drafts or published posts.
 * Version: 1.1.0
 * Requires at least: 6.2
 * Requires PHP: 8.0
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) { exit; }

final class Recipe_Intelligence_Bridge {
    const VERSION = '1.1.0';
    const NS = 'recipe-intelligence/v1';
    const OPTION = 'ri_bridge_recipe_card';
    const TOKEN_OPTION = 'ri_bridge_site_token';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_ri_bridge_settings', [__CLASS__, 'save_settings']);
        add_action('admin_post_ri_bridge_token', [__CLASS__, 'save_token']);
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_shortcode('ri_recipe', [__CLASS__, 'card']);
        add_action('wp_head', [__CLASS__, 'schema']);
    }
    public static function adapters() {
        return [
            'builtin' => ['label' => 'Recipe Intelligence card', 'available' => true, 'supported' => true],
            'wprm' => ['label' => 'WP Recipe Maker', 'available' => post_type_exists('wprm_recipe') && class_exists('WPRM_Recipe_Sanitizer') && is_callable(['WPRM_Recipe_Saver', 'update_recipes_in_post']), 'supported' => true],
            'tasty' => ['label' => 'Tasty Recipes', 'available' => post_type_exists('tasty_recipe'), 'supported' => false],
            'create' => ['label' => 'Create by Mediavine', 'available' => defined('MV_CREATE_VERSION'), 'supported' => false],
        ];
    }
    public static function profile() {
        $adapters = self::adapters();
        $selected = get_option(self::OPTION, '');
        $ready = isset($adapters[$selected]) && $adapters[$selected]['available'] && $adapters[$selected]['supported'];
        return ['version' => self::VERSION, 'protocol' => 1, 'siteUrl' => home_url('/'), 'siteName' => get_bloginfo('name'),
            'recipeCard' => $selected, 'recipeCardLabel' => $adapters[$selected]['label'] ?? 'Choose in WordPress settings',
            'ready' => $ready, 'revision' => hash('sha256', wp_json_encode([$selected, $adapters, self::VERSION])),
            'adapters' => $adapters, 'canPublish' => current_user_can('publish_posts'),
            'settingsUrl' => admin_url('options-general.php?page=recipe-intelligence'), 'tokenAuth' => true,
            'user' => ['id' => get_current_user_id(), 'username' => wp_get_current_user()->user_login, 'slug' => wp_get_current_user()->user_nicename, 'displayName' => wp_get_current_user()->display_name]];
    }
    public static function menu() {
        add_menu_page('Recipe Intelligence', 'Recipe Intelligence', 'manage_options', 'recipe-intelligence', [__CLASS__, 'settings'], 'dashicons-admin-links', 81);
        add_options_page('Recipe Intelligence', 'Recipe Intelligence', 'manage_options', 'recipe-intelligence', [__CLASS__, 'settings']);
    }
    private static function eligible($user) {
        return $user instanceof WP_User && array_intersect(['administrator', 'editor'], $user->roles) && $user->has_cap('edit_posts') && $user->has_cap('upload_files');
    }
    private static function eligible_users() {
        return array_values(array_filter(get_users(['role__in' => ['administrator', 'editor'], 'orderby' => 'display_name']), [__CLASS__, 'eligible']));
    }
    // Only a digest is used for authentication. An encrypted copy lets the site
    // administrator copy the token again without storing it as a plaintext option.
    public static function create_token() {
        if (!current_user_can('manage_options')) { return new WP_Error('ri_forbidden', 'Administrator access required.', ['status' => 403]); }
        if (!function_exists('openssl_encrypt')) { return new WP_Error('ri_crypto', 'Your host must enable OpenSSL before creating a Site Token.'); }
        $token = 'ri_' . bin2hex(random_bytes(32)); $iv = random_bytes(12); $tag = '';
        $sealed = openssl_encrypt($token, 'aes-256-gcm', hash('sha256', wp_salt('auth'), true), OPENSSL_RAW_DATA, $iv, $tag, self::TOKEN_OPTION);
        if ($sealed === false) { return new WP_Error('ri_crypto', 'Could not protect the Site Token.'); }
        $record = ['hash' => hash('sha256', $token), 'sealed' => base64_encode($sealed), 'iv' => base64_encode($iv), 'tag' => base64_encode($tag), 'users' => array_map(function ($u) { return $u->ID; }, self::eligible_users()), 'created' => time(), 'last_used' => 0];
        update_option(self::TOKEN_OPTION, $record, false);
        return $token;
    }
    private static function readable_token($record) {
        if (!is_array($record) || !function_exists('openssl_decrypt')) { return ''; }
        $iv = base64_decode($record['iv'] ?? '', true); $tag = base64_decode($record['tag'] ?? '', true); $sealed = base64_decode($record['sealed'] ?? '', true);
        if (!$iv || strlen($iv) !== 12 || !$tag || strlen($tag) !== 16 || !$sealed) { return ''; }
        $token = openssl_decrypt($sealed, 'aes-256-gcm', hash('sha256', wp_salt('auth'), true), OPENSSL_RAW_DATA, $iv, $tag, self::TOKEN_OPTION);
        return is_string($token) && preg_match('/^ri_[a-f0-9]{64}$/D', $token) ? $token : '';
    }
    public static function save_token() {
        if (!current_user_can('manage_options')) { wp_die('Administrator access required.', '', ['response' => 403]); }
        check_admin_referer('ri_bridge_token');
        if (($_POST['token_action'] ?? '') === 'revoke') { delete_option(self::TOKEN_OPTION); }
        elseif (($_POST['token_action'] ?? '') === 'create') {
            $result = self::create_token(); if (is_wp_error($result)) { wp_die(esc_html($result->get_error_message())); }
        } else { wp_die('Invalid token action.', '', ['response' => 400]); }
        wp_safe_redirect(admin_url('admin.php?page=recipe-intelligence')); exit;
    }
    public static function settings() {
        if (!current_user_can('manage_options')) { return; }
        nocache_headers();
        $selected = get_option(self::OPTION, '');
        $record = get_option(self::TOKEN_OPTION, []); $token = self::readable_token($record);
        echo '<div class="wrap ri-bridge"><style>.ri-bridge{max-width:1120px;margin:24px 20px 40px 0}.ri-bridge .ri-panel{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:26px;margin:22px 0;box-shadow:0 1px 3px #00000008}.ri-bridge h1{font-size:26px}.ri-bridge h2{margin:0 0 10px}.ri-bridge .ri-muted{color:#596678}.ri-bridge .ri-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ri-bridge .ri-row input{flex:1;min-width:180px;max-width:100%;font-family:monospace;padding:10px}.ri-bridge .ri-user{background:#f6f8fa;border-radius:10px;padding:15px;margin:12px 0}.ri-bridge .ri-user-info{flex:1;min-width:140px}.ri-bridge .ri-badge{display:inline-block;border-radius:20px;padding:5px 12px;background:#e7f7f0;color:#116b50}.ri-bridge .button{min-height:38px}.ri-bridge .ri-actions form{display:inline-block;margin-right:12px}.ri-bridge .ri-status{min-height:24px}.ri-bridge select{min-width:240px;max-width:100%}</style>';
        echo '<div class="ri-panel"><div class="ri-row"><h1 style="flex:1">Recipe Intelligence Bridge</h1><span class="ri-badge">' . (!empty($record['last_used']) ? 'Connection verified' : 'Ready to connect') . '</span></div><p class="ri-muted">Connect your website, send articles with hosted images, and add your default recipe card.</p><p>Bridge version ' . esc_html(self::VERSION) . '</p>';
        if (!empty($record['last_used'])) { echo '<p>Last successful connection: ' . esc_html(wp_date('Y-m-d H:i:s', $record['last_used'])) . '</p>'; }
        echo '</div><section class="ri-panel"><h2>1. Copy Site Token</h2><p class="ri-muted">Use this plugin’s token in the app. No WordPress login password or Application Password is needed.</p><p><label for="ri-site-url"><strong>Website URL</strong></label></p><div class="ri-row"><input id="ri-site-url" readonly value="' . esc_attr(home_url('/')) . '"><button type="button" class="button" data-ri-copy="ri-site-url">Copy URL</button></div>';
        if ($token) {
            echo '<p><label for="ri-site-token"><strong>Site Token</strong></label></p><div class="ri-row"><input id="ri-site-token" type="password" readonly autocomplete="off" value="' . esc_attr($token) . '"><button type="button" class="button" id="ri-show-token" aria-controls="ri-site-token" aria-pressed="false">Show token</button><button type="button" class="button" data-ri-copy="ri-site-token">Copy token</button></div>';
        } elseif ($record) { echo '<p>The saved token cannot be displayed after a site security-key change. Create a new token and reconnect the app.</p>'; }
        echo '<p class="ri-muted">The token permits recipe exports and image uploads as the authorized user you choose below. It cannot manage users, plugins, or website settings. Regenerating or revoking it disconnects apps using the old token.</p><div class="ri-actions">';
        foreach (array_filter(['create', $record ? 'revoke' : null]) as $action) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('ri_bridge_token');
            echo '<input type="hidden" name="action" value="ri_bridge_token"><input type="hidden" name="token_action" value="' . esc_attr($action) . '">';
            submit_button($action === 'revoke' ? 'Revoke token' : ($record ? 'Regenerate Site Token' : 'Create Site Token'), $action === 'revoke' ? 'secondary' : 'primary', 'submit', false);
            echo '</form>';
        }
        echo '</div><p id="ri-copy-status" class="ri-status" role="status" aria-live="polite"></p></section><section class="ri-panel"><h2>2. Copy User Slug</h2><p class="ri-muted">Only Administrators and Editors with permission to edit posts and upload files can connect. Posts are attributed to the selected user.</p>';
        $users = self::eligible_users();
        if ($record) { $users = array_values(array_filter($users, function ($u) use ($record) { return in_array($u->ID, $record['users'] ?? [], true); })); }
        echo '<h3>Authorized Users (' . count($users) . ')</h3>';
        foreach ($users as $u) {
            $id = 'ri-slug-' . $u->ID;
            echo '<div class="ri-row ri-user"><div class="ri-user-info"><strong>' . esc_html($u->display_name) . '</strong><br><span class="ri-badge">' . (in_array('administrator', $u->roles, true) ? 'Administrator' : 'Editor') . '</span></div><label class="screen-reader-text" for="' . esc_attr($id) . '">User Slug for ' . esc_html($u->display_name) . '</label><input id="' . esc_attr($id) . '" readonly value="' . esc_attr($u->user_nicename) . '"><button type="button" class="button" data-ri-copy="' . esc_attr($id) . '">Copy slug</button></div>';
        }
        echo '<p>In the app: Settings → WordPress websites → Site Token. Paste the Website URL, Site Token and one User Slug, then click Connect website.</p><p class="ri-muted">Newly added users need a regenerated token to join this list. Users who lose the required role or permissions lose access immediately.</p></section><section class="ri-panel"><h2>3. Choose the default recipe card</h2><p class="ri-muted">The app reads this setting before sending an article. Finished images go to your Media Library; the first article image becomes the featured image.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('ri_bridge_settings');
        echo '<input type="hidden" name="action" value="ri_bridge_settings"><p><label for="ri-card"><strong>Default recipe card</strong></label></p><select id="ri-card" name="recipe_card" required><option value="">Choose a recipe card</option>';
        foreach (self::adapters() as $id => $adapter) {
            $enabled = $adapter['available'] && $adapter['supported'];
            $note = !$adapter['supported'] ? ' — integration not yet supported' : (!$adapter['available'] ? ' — activate this plugin first' : '');
            echo '<option value="' . esc_attr($id) . '" ' . selected($selected, $id, false) . (!$enabled ? ' disabled' : '') . '>' . esc_html($adapter['label'] . $note) . '</option>';
        }
        echo '</select>';
        submit_button('Save default recipe card');
        echo '</form><p>Choose Save draft or Publish live in the app for each article. Live publishing also requires the selected user’s publish_posts permission.</p></section><details class="ri-panel"><summary>Alternative: Application Password connection</summary><p>Existing connections still work. In Users → Profile, create an Application Password. In the app, select Application Password and enter your website URL, login username and generated password.</p></details></div>';
        echo '<script>(function(){const root=document.querySelector(".ri-bridge");if(!root)return;root.addEventListener("click",async function(e){const b=e.target.closest("[data-ri-copy]");if(b){const i=document.getElementById(b.dataset.riCopy),s=document.getElementById("ri-copy-status");try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(i.value);}else{const old=i.type;i.type="text";i.focus();i.select();const ok=document.execCommand("copy");i.type=old;if(!ok)throw Error();}s.textContent="Copied. Paste it into the Recipe Intelligence app.";}catch{ s.textContent="Copy unavailable. Select the field and copy it manually.";}}if(e.target.id==="ri-show-token"){const i=document.getElementById("ri-site-token"),show=i.type==="password";i.type=show?"text":"password";e.target.textContent=show?"Hide token":"Show token";e.target.setAttribute("aria-pressed",String(show));}});})();</script>';
    }
    public static function save_settings() {
        if (!current_user_can('manage_options')) { wp_die('Administrator access required.', '', ['response' => 403]); }
        check_admin_referer('ri_bridge_settings');
        $value = sanitize_key(wp_unslash($_POST['recipe_card'] ?? ''));
        $adapter = self::adapters()[$value] ?? null;
        if (!$adapter || !$adapter['available'] || !$adapter['supported']) { wp_die('Choose an active supported recipe card.'); }
        update_option(self::OPTION, $value, false);
        wp_safe_redirect(admin_url('options-general.php?page=recipe-intelligence&updated=1')); exit;
    }
    private static function token_user($request) {
        $token = $request->get_header('x-recipe-intelligence-key');
        if ($token === null) { return null; }
        if (!is_ssl()) { return new WP_Error('ri_https_required', 'HTTPS is required.', ['status' => 403]); }
        $record = get_option(self::TOKEN_OPTION, []);
        if (!is_string($token) || !preg_match('/^ri_[a-f0-9]{64}$/D', $token) || !is_array($record) || empty($record['hash']) || !hash_equals($record['hash'], hash('sha256', $token))) { return new WP_Error('ri_invalid_token', 'The Site Token is invalid or revoked.', ['status' => 401]); }
        $slug = $request->get_header('x-recipe-intelligence-user');
        $user = is_string($slug) && preg_match('/^[a-zA-Z0-9_%.-]{1,100}$/D', $slug) ? get_user_by('slug', $slug) : false;
        if (!self::eligible($user) || !in_array($user->ID, $record['users'] ?? [], true)) { return new WP_Error('ri_user_forbidden', 'Choose an authorized Administrator or Editor.', ['status' => 403]); }
        return $user;
    }
    public static function permission($request = null) {
        $user = $request ? self::token_user($request) : null;
        if (is_wp_error($user)) { return $user; }
        if ($user instanceof WP_User) { return true; }
        return current_user_can('edit_posts') && current_user_can('upload_files') ? true : new WP_Error('ri_forbidden', 'Use a WordPress account with edit_posts and upload_files permission.', ['status' => 403]);
    }
    // Token authentication is scoped to these callbacks. It never authenticates
    // WordPress administration or arbitrary REST routes, including nested batches.
    public static function dispatch($request) {
        $allowed = self::permission($request); if (is_wp_error($allowed)) { return $allowed; }
        $user = self::token_user($request); if (is_wp_error($user)) { return $user; }
        $previous = get_current_user_id();
        if ($user instanceof WP_User) { wp_set_current_user($user->ID); }
        try {
            $route = $request->get_route();
            if ($route === '/' . self::NS . '/profile') {
                if ($user instanceof WP_User) {
                    $record = get_option(self::TOKEN_OPTION);
                    if (is_array($record) && (int) ($record['last_used'] ?? 0) < time() - 60) { $record['last_used'] = time(); update_option(self::TOKEN_OPTION, $record, false); }
                }
                return self::profile();
            }
            if ($route === '/' . self::NS . '/media') { return self::media($request); }
            return $request->get_method() === 'POST' ? self::receive($request) : self::lookup($request);
        } finally { if ($user instanceof WP_User) { wp_set_current_user($previous); } }
    }
    public static function media($request) {
        $slug = $request->get_param('slug');
        if (!is_string($slug) || !preg_match('/^ri-[a-f0-9]{64}$/D', $slug)) { return new WP_Error('ri_media', 'A Recipe Intelligence image slug is required.', ['status' => 400]); }
        $native = new WP_REST_Request($request->get_method(), '/wp/v2/media');
        $native->set_param('slug', $slug);
        if ($request->get_method() === 'GET') { $native->set_param('context', 'edit'); $native->set_param('per_page', 2); }
        else {
            foreach (['title', 'alt_text'] as $field) {
                $value = $request->get_param($field) ?? '';
                if (!is_string($value) || strlen($value) > 6000) { return new WP_Error('ri_media', 'Invalid image description.', ['status' => 400]); }
                $native->set_param($field, $value);
            }
            $files = $request->get_file_params(); $file = $files['file'] ?? null;
            if ($file) {
                if (!is_array($file) || ($file['type'] ?? '') !== 'image/webp' || !is_file($file['tmp_name'] ?? '') || filesize($file['tmp_name']) > 10 * 1024 * 1024) { return new WP_Error('ri_media', 'Upload a WebP image up to 10 MB.', ['status' => 400]); }
                $native->set_file_params(['file' => $file]);
            } else {
                if ($request->get_header('content-type') !== 'image/webp' || strlen($request->get_body()) > 10 * 1024 * 1024) { return new WP_Error('ri_media', 'Upload a WebP image up to 10 MB.', ['status' => 400]); }
                $native->set_header('content-type', 'image/webp');
                $native->set_header('content-disposition', 'attachment; filename="' . $slug . '.webp"');
                $native->set_body($request->get_body());
            }
        }
        return rest_do_request($native);
    }
    public static function routes() {
        register_rest_route(self::NS, '/profile', ['methods' => 'GET', 'callback' => [__CLASS__, 'dispatch'], 'permission_callback' => [__CLASS__, 'permission']]);
        register_rest_route(self::NS, '/exports/(?P<id>[a-f0-9]{64})', ['methods' => 'GET', 'callback' => [__CLASS__, 'dispatch'], 'permission_callback' => [__CLASS__, 'permission']]);
        register_rest_route(self::NS, '/exports', ['methods' => 'POST', 'callback' => [__CLASS__, 'dispatch'], 'permission_callback' => [__CLASS__, 'permission']]);
        register_rest_route(self::NS, '/media', ['methods' => ['GET', 'POST'], 'callback' => [__CLASS__, 'dispatch'], 'permission_callback' => [__CLASS__, 'permission']]);
    }
    public static function lookup($request) {
        $record = get_option('ri_export_' . $request['id']);
        if (!$record) { return new WP_Error('ri_missing', 'Export not found.', ['status' => 404]); }
        if (intval($record['owner']) !== get_current_user_id() && !current_user_can('manage_options')) { return new WP_Error('ri_forbidden', 'This export belongs to another user.', ['status' => 403]); }
        if (!empty($record['postId']) && !current_user_can('edit_post', $record['postId'])) { return new WP_Error('ri_forbidden', 'You cannot edit this post.', ['status' => 403]); }
        if ($record['state'] !== 'ready') { return new WP_Error('ri_uncertain', 'The earlier export is incomplete. Inspect WordPress drafts before retrying; no duplicate was created.', ['status' => 409]); }
        return self::result($record);
    }
    private static function result($record) {
        $post = get_post($record['postId']);
        if (!$post || $post->post_status === 'trash') { return new WP_Error('ri_missing_post', 'The exported post was removed. Restore it in WordPress; the app will not create a duplicate.', ['status' => 409]); }
        return ['postId' => $post->ID, 'status' => $post->post_status, 'editUrl' => admin_url('post.php?post=' . $post->ID . '&action=edit'), 'postUrl' => get_permalink($post->ID), 'recipeCard' => $record['recipeCard'], 'recipeId' => $record['recipeId'] ?? null];
    }
    private static function strings($values, $limit) {
        if (!is_array($values) || count($values) > $limit) { throw new InvalidArgumentException('Invalid recipe list.'); }
        $result = [];
        foreach ($values as $value) {
            if (!is_string($value) || strlen($value) > 6000 || trim($value) === '') { throw new InvalidArgumentException('Invalid recipe text.'); }
            $result[] = sanitize_textarea_field($value);
        }
        return $result;
    }
    public static function clean_recipe($value) {
        if (!is_array($value) || !is_string($value['name'] ?? null) || trim($value['name']) === '') { throw new InvalidArgumentException('Recipe title is required.'); }
        $recipe = ['@context' => 'https://schema.org', '@type' => 'Recipe', 'name' => sanitize_text_field($value['name']), 'description' => sanitize_textarea_field($value['description'] ?? '')];
        $recipe['recipeIngredient'] = self::strings($value['recipeIngredient'] ?? [], 200);
        $recipe['recipeInstructions'] = self::strings($value['instructions'] ?? [], 200);
        if (!$recipe['recipeIngredient'] || !$recipe['recipeInstructions']) { throw new InvalidArgumentException('A recipe card needs ingredients and instructions.'); }
        foreach (['prepTime', 'cookTime', 'totalTime'] as $key) {
            if (!empty($value[$key])) {
                if (!is_string($value[$key]) || !preg_match('/^P(?=\d|T\d)(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/D', $value[$key])) { throw new InvalidArgumentException('Unsupported recipe duration.'); }
                $recipe[$key] = $value[$key];
            }
        }
        if (!empty($value['recipeYield'])) { $recipe['recipeYield'] = sanitize_text_field($value['recipeYield']); }
        return $recipe;
    }
    public static function wprm_payload($recipe, $image_id) {
        $data = ['name' => $recipe['name'], 'summary' => $recipe['description'], 'type' => 'food', 'image_id' => $image_id,
            'ingredients_flat' => array_map(function ($text) { return ['type' => 'ingredient', 'name' => $text, 'amount' => '', 'unit' => '', 'notes' => '']; }, $recipe['recipeIngredient']),
            'instructions_flat' => array_map(function ($text) { return ['type' => 'instruction', 'text' => $text, 'image' => 0]; }, $recipe['recipeInstructions'])];
        // Keep complete ingredient lines. Do not guess units or fractions to enable scaling.
        $notes = [];
        if (!empty($recipe['recipeYield'])) {
            if (preg_match('/^(\d+(?:\.\d+)?)\s*(.*)$/D', $recipe['recipeYield'], $match) && !preg_match('/^[–—\-\/]/u', $match[2])) { $data['servings'] = $match[1]; $data['servings_unit'] = $match[2]; }
            else { $notes[] = 'Yield: ' . $recipe['recipeYield']; }
        }
        foreach (['prepTime' => 'prep_time', 'cookTime' => 'cook_time', 'totalTime' => 'total_time'] as $key => $field) {
            if (empty($recipe[$key])) { continue; }
            $duration = new DateInterval($recipe[$key]);
            if ($duration->s) { $notes[] = $key . ': ' . $recipe[$key]; }
            else { $data[$field] = $duration->d * 1440 + $duration->h * 60 + $duration->i; }
        }
        if ($notes) { $data['notes'] = implode("\n", $notes); }
        return $data;
    }
    public static function receive($request) {
        if (strlen($request->get_body()) > 1500000) { return new WP_Error('ri_size', 'Export exceeds 1.5 MB.', ['status' => 413]); }
        $input = $request->get_json_params();
        if (!is_array($input)) { return new WP_Error('ri_input', 'Expected JSON.', ['status' => 400]); }
        $id = $input['exportId'] ?? ''; $status = $input['status'] ?? 'draft';
        if (!is_string($id) || !preg_match('/^[a-f0-9]{64}$/D', $id) || !in_array($status, ['draft', 'publish'], true)) { return new WP_Error('ri_input', 'Invalid export ID or status.', ['status' => 400]); }
        if ($status === 'publish' && (!current_user_can('publish_posts') || ($input['confirmPublish'] ?? false) !== true)) { return new WP_Error('ri_publish', 'Explicit publish confirmation and publish_posts permission are required.', ['status' => 403]); }
        $profile = self::profile();
        if (!$profile['ready'] || ($input['profileRevision'] ?? '') !== $profile['revision'] || ($input['recipeCard'] ?? '') !== $profile['recipeCard']) { return new WP_Error('ri_profile_changed', 'Recipe-card settings changed. Refresh the website settings in the app and review again.', ['status' => 409]); }
        try { $recipe = self::clean_recipe($input['recipe'] ?? []); } catch (Throwable $e) { return new WP_Error('ri_recipe', $e->getMessage(), ['status' => 400]); }
        $content = $input['content'] ?? ''; $title = $input['title'] ?? '';
        if (!is_string($content) || !is_string($title) || !trim($title) || substr_count($content, '<!--ri-recipe-card-->') !== 1) { return new WP_Error('ri_input', 'Provide a title and exactly one recipe-card placeholder.', ['status' => 400]); }
        $media_ids = $input['mediaIds'] ?? [];
        if (!is_array($media_ids) || count($media_ids) > 100) { return new WP_Error('ri_media', 'Invalid media list.', ['status' => 400]); }
        $urls = [];
        foreach ($media_ids as $media_id) {
            if (!is_int($media_id) || !wp_attachment_is_image($media_id) || !current_user_can('edit_post', $media_id)) { return new WP_Error('ri_media', 'An uploaded image is unavailable or inaccessible.', ['status' => 400]); }
            $urls[] = wp_get_attachment_url($media_id);
        }
        preg_match_all('/<img\b[^>]*\bsrc\s*=\s*["\']([^"\']*)["\']/i', $content, $images);
        foreach ($images[1] as $url) { if (!in_array(html_entity_decode($url, ENT_QUOTES), $urls, true)) { return new WP_Error('ri_media', 'Only this export’s uploaded WordPress images may be embedded.', ['status' => 400]); } }
        $hash_input = $input; unset($hash_input['status'], $hash_input['confirmPublish']);
        $hash = hash('sha256', wp_json_encode($hash_input));
        $key = 'ri_export_' . $id; $lock = 'ri_export_lock_' . $id;
        // add_option is an atomic unique insert. Never expire an uncertain lock automatically.
        if (!add_option($lock, time(), '', false)) { return new WP_Error('ri_busy', 'This export is already running or requires administrator review.', ['status' => 409]); }
        try {
            $record = get_option($key);
            if ($record) {
                if (!hash_equals($record['hash'], $hash) || intval($record['owner']) !== get_current_user_id()) { return new WP_Error('ri_conflict', 'This export ID belongs to different content or a different user.', ['status' => 409]); }
                if ($record['state'] !== 'ready' || !current_user_can('edit_post', $record['postId'])) { return new WP_Error('ri_uncertain', 'Inspect the existing WordPress draft. This export will not create a duplicate.', ['status' => 409]); }
                $existing = get_post($record['postId']);
                if (!$existing || $existing->post_status === 'trash') { return self::result($record); }
                if ($status === 'publish' && $existing->post_status === 'draft') {
                    $updated = wp_update_post(['ID' => $record['postId'], 'post_status' => 'publish'], true);
                    if (is_wp_error($updated)) { return $updated; }
                    if (!empty($record['recipeId'])) { WPRM_Recipe_Saver::update_recipes_in_post($record['postId'], [$record['recipeId']], get_current_user_id()); }
                }
                return self::result($record);
            }
            $record = ['hash' => $hash, 'owner' => get_current_user_id(), 'state' => 'creating', 'recipeCard' => $profile['recipeCard']];
            update_option($key, $record, false);
            $post_id = wp_insert_post(['post_type' => 'post', 'post_status' => 'draft', 'post_author' => get_current_user_id(), 'post_title' => sanitize_text_field($title), 'post_name' => sanitize_title($input['slug'] ?? ''), 'post_excerpt' => sanitize_textarea_field($input['excerpt'] ?? ''), 'meta_input' => ['_ri_export_id' => $id]], true);
            if (is_wp_error($post_id)) { return $post_id; }
            $record['postId'] = $post_id; update_option($key, $record, false);
            $featured = $media_ids[0] ?? 0;
            if ($urls) { $recipe['image'] = $urls; }
            update_post_meta($post_id, '_ri_recipe', $recipe);
            update_post_meta($post_id, '_ri_recipe_card', $profile['recipeCard']);
            if ($profile['recipeCard'] === 'wprm') {
                $native = new WP_REST_Request('POST', '/wp/v2/wprm_recipe');
                $native->set_param('status', 'draft');
                $native->set_param('recipe', self::wprm_payload($recipe, $featured));
                $response = rest_do_request($native);
                if ($response->is_error()) { return new WP_Error('ri_card', 'WP Recipe Maker could not create the card. The article remains a draft; inspect it in WordPress.', ['status' => 409]); }
                $record['recipeId'] = intval($response->get_data()['id'] ?? 0);
                if (!$record['recipeId']) { return new WP_Error('ri_card', 'Recipe card creation was not confirmed. Inspect WordPress drafts.', ['status' => 409]); }
                update_option($key, $record, false);
                $embed = '<!-- wp:wp-recipe-maker/recipe {"id":' . $record['recipeId'] . '} -->[wprm-recipe id="' . $record['recipeId'] . '"]<!-- /wp:wp-recipe-maker/recipe -->';
            } else { $embed = '<!-- wp:shortcode -->[ri_recipe id="' . $post_id . '"]<!-- /wp:shortcode -->'; }
            // Neutralize arbitrary source shortcodes before inserting our own trusted card.
            $safe = wp_kses_post(str_replace(['[', ']'], ['&#91;', '&#93;'], $content));
            $safe = str_replace('<!--ri-recipe-card-->', $embed, $safe);
            if ($featured) { set_post_thumbnail($post_id, $featured); }
            $saved = wp_update_post(['ID' => $post_id, 'post_content' => wp_slash($safe), 'post_status' => 'draft'], true);
            if (is_wp_error($saved)) { return $saved; }
            if (!empty($record['recipeId'])) { WPRM_Recipe_Saver::update_recipes_in_post($post_id, [$record['recipeId']], get_current_user_id()); }
            if ($status === 'publish') {
                $published = wp_update_post(['ID' => $post_id, 'post_status' => 'publish'], true);
                if (is_wp_error($published)) { return $published; }
                if (!empty($record['recipeId'])) { WPRM_Recipe_Saver::update_recipes_in_post($post_id, [$record['recipeId']], get_current_user_id()); }
            }
            $record['state'] = 'ready'; update_option($key, $record, false);
            return self::result($record);
        } finally { delete_option($lock); }
    }
    public static function card($attrs) {
        $id = absint($attrs['id'] ?? 0);
        $post = get_post($id);
        if (!$post || ($post->post_status !== 'publish' && !current_user_can('edit_post', $id)) || post_password_required($post)) { return ''; }
        $recipe = get_post_meta($id, '_ri_recipe', true);
        if (!is_array($recipe)) { return ''; }
        $html = '<section class="ri-recipe-card" aria-label="Recipe card"><h2>' . esc_html($recipe['name']) . '</h2><p>' . esc_html($recipe['description']) . '</p>';
        foreach (['recipeYield' => 'Servings', 'prepTime' => 'Prep time', 'cookTime' => 'Cook time', 'totalTime' => 'Total time'] as $key => $label) {
            if (!empty($recipe[$key])) {
                $value = $recipe[$key];
                if ($key !== 'recipeYield') { $d = new DateInterval($value); $parts = []; foreach (['d' => 'days', 'h' => 'hours', 'i' => 'minutes', 's' => 'seconds'] as $unit => $name) { if ($d->$unit) { $parts[] = $d->$unit . ' ' . $name; } } $value = $parts ? implode(' ', $parts) : '0 minutes'; }
                $html .= '<p><strong>' . esc_html($label) . ':</strong> ' . esc_html($value) . '</p>';
            }
        }
        $html .= '<h3>Ingredients</h3><ul>';
        foreach ($recipe['recipeIngredient'] as $line) { $html .= '<li>' . esc_html($line) . '</li>'; }
        $html .= '</ul><h3>Instructions</h3><ol>';
        foreach ($recipe['recipeInstructions'] as $line) { $html .= '<li>' . esc_html($line) . '</li>'; }
        return $html . '</ol></section>';
    }
    public static function schema() {
        if (!is_singular('post')) { return; }
        $id = get_queried_object_id();
        if (get_post_status($id) !== 'publish' || post_password_required($id) || get_post_meta($id, '_ri_recipe_card', true) !== 'builtin') { return; }
        $recipe = get_post_meta($id, '_ri_recipe', true);
        if (!is_array($recipe)) { return; }
        $recipe['recipeInstructions'] = array_map(function ($text) { return ['@type' => 'HowToStep', 'text' => $text]; }, $recipe['recipeInstructions']);
        echo '<script type="application/ld+json">' . wp_json_encode($recipe, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . '</script>';
    }
}
Recipe_Intelligence_Bridge::init();
