-- =============================================================================
-- Mimos Korea - WooCommerce / MariaDB read-only diagnostics
-- =============================================================================
--
-- Purpose: close the gaps that the public-API audit cannot see (drafts, trash,
-- orphans, lookup-table drift, clone metadata, order history). Every statement
-- is a SELECT. Nothing here writes to the database.
--
-- How to run:
--   1. Prefer a fresh backup/replica (mysqldump -> local MariaDB), not production.
--   2. Replace the table prefix "wp_" if the site uses another one
--      (check: SHOW TABLES LIKE '%posts';).
--   3. Run section by section (phpMyAdmin, Adminer, `mariadb` CLI or
--      `wp db query "<sql>"` with WP-CLI) and save each result as CSV.
--
-- Background: WordPress uses ONE auto-increment ID sequence (wp_posts.ID) for
-- products, variations, images, pages, revisions, menu items, order
-- placeholders, templates, etc. Gaps in product IDs are therefore normal and
-- are NOT corruption. Never renumber IDs. The real problems are hidden
-- duplicates, orphans and data drift, which the queries below measure.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 01. Who consumes the ID sequence (all post types and statuses)
-- -----------------------------------------------------------------------------
SELECT post_type, post_status, COUNT(*) AS n, MIN(ID) AS min_id, MAX(ID) AS max_id
FROM wp_posts
GROUP BY post_type, post_status
ORDER BY n DESC;


-- -----------------------------------------------------------------------------
-- 02. Products and variations by status
-- -----------------------------------------------------------------------------
SELECT post_type, post_status, COUNT(*) AS n
FROM wp_posts
WHERE post_type IN ('product', 'product_variation')
GROUP BY post_type, post_status
ORDER BY post_type, post_status;


-- -----------------------------------------------------------------------------
-- 03. Every non-published product (draft, pending, private, trash, auto-draft)
-- -----------------------------------------------------------------------------
SELECT p.ID, p.post_status, p.post_title, p.post_name, p.post_date, p.post_modified,
       u.user_login AS author,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_wp_trash_meta_time') AS trashed_at_unix,
       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sku') AS sku
FROM wp_posts p
LEFT JOIN wp_users u ON u.ID = p.post_author
WHERE p.post_type = 'product' AND p.post_status <> 'publish'
ORDER BY p.ID;


-- -----------------------------------------------------------------------------
-- 04. Clones created with Yoast Duplicate Post (meta _dp_original)
--     Shows which product was cloned from which, and the status of both.
-- -----------------------------------------------------------------------------
SELECT p.ID AS clone_id, p.post_status AS clone_status, p.post_title AS clone_title,
       pm.meta_value AS original_id, o.post_status AS original_status, o.post_title AS original_title
FROM wp_posts p
JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_dp_original'
LEFT JOIN wp_posts o ON o.ID = pm.meta_value
WHERE p.post_type IN ('product', 'product_variation')
ORDER BY p.ID;


-- -----------------------------------------------------------------------------
-- 05. Duplicate SKUs across ALL statuses (WooCommerce expects unique SKUs)
-- -----------------------------------------------------------------------------
SELECT pm.meta_value AS sku, COUNT(*) AS n,
       GROUP_CONCAT(CONCAT(p.ID, ':', p.post_status) ORDER BY p.ID SEPARATOR ', ') AS products
FROM wp_postmeta pm
JOIN wp_posts p ON p.ID = pm.post_id
WHERE pm.meta_key = '_sku' AND pm.meta_value <> ''
  AND p.post_type IN ('product', 'product_variation')
GROUP BY pm.meta_value
HAVING n > 1
ORDER BY n DESC;


-- -----------------------------------------------------------------------------
-- 06. Duplicate titles across statuses (published copy + draft copy + trash copy)
-- -----------------------------------------------------------------------------
SELECT post_title, COUNT(*) AS n,
       GROUP_CONCAT(CONCAT(ID, ':', post_status) ORDER BY ID SEPARATOR ', ') AS products
FROM wp_posts
WHERE post_type = 'product' AND post_status <> 'auto-draft'
GROUP BY post_title
HAVING n > 1
ORDER BY n DESC;


-- -----------------------------------------------------------------------------
-- 07. Slugs changed by collisions or trash (post_name "-2", "__trashed")
-- -----------------------------------------------------------------------------
SELECT ID, post_status, post_name, post_title
FROM wp_posts
WHERE post_type = 'product'
  AND (post_name LIKE '%\_\_trashed%' OR post_name REGEXP '-[0-9]+$')
ORDER BY post_name;


-- -----------------------------------------------------------------------------
-- 08. Orphan rows (point to posts that no longer exist)
-- -----------------------------------------------------------------------------
SELECT 'postmeta without post' AS check_name, COUNT(*) AS n
FROM wp_postmeta pm LEFT JOIN wp_posts p ON p.ID = pm.post_id
WHERE p.ID IS NULL
UNION ALL
SELECT 'term_relationships without post', COUNT(*)
FROM wp_term_relationships tr LEFT JOIN wp_posts p ON p.ID = tr.object_id
WHERE p.ID IS NULL
UNION ALL
SELECT 'variations without parent product', COUNT(*)
FROM wp_posts v LEFT JOIN wp_posts p ON p.ID = v.post_parent
WHERE v.post_type = 'product_variation' AND p.ID IS NULL
UNION ALL
SELECT 'attachments whose parent was deleted', COUNT(*)
FROM wp_posts a LEFT JOIN wp_posts p ON p.ID = a.post_parent
WHERE a.post_type = 'attachment' AND a.post_parent <> 0 AND p.ID IS NULL
UNION ALL
SELECT 'comments/reviews without post', COUNT(*)
FROM wp_comments c LEFT JOIN wp_posts p ON p.ID = c.comment_post_ID
WHERE p.ID IS NULL;


-- -----------------------------------------------------------------------------
-- 09. Images attached to products that are NOT published
--     (the public API hides these; the audit counted 9 of them)
-- -----------------------------------------------------------------------------
SELECT a.ID AS attachment_id, a.guid, p.ID AS product_id, p.post_status, p.post_title
FROM wp_posts a
JOIN wp_posts p ON p.ID = a.post_parent
WHERE a.post_type = 'attachment' AND p.post_type = 'product' AND p.post_status <> 'publish'
ORDER BY p.ID;


-- -----------------------------------------------------------------------------
-- 10. Images not used as featured image nor in any product gallery
-- -----------------------------------------------------------------------------
SELECT a.ID, a.post_date, a.guid
FROM wp_posts a
WHERE a.post_type = 'attachment' AND a.post_mime_type LIKE 'image/%'
  AND NOT EXISTS (SELECT 1 FROM wp_postmeta t WHERE t.meta_key = '_thumbnail_id' AND t.meta_value = a.ID)
  AND NOT EXISTS (SELECT 1 FROM wp_postmeta g WHERE g.meta_key = '_product_image_gallery' AND FIND_IN_SET(a.ID, g.meta_value))
ORDER BY a.ID;


-- -----------------------------------------------------------------------------
-- 11. Products whose featured image points to a missing attachment,
--     and products with no featured image at all
-- -----------------------------------------------------------------------------
SELECT p.ID, p.post_status, p.post_title, t.meta_value AS thumbnail_id, 'thumbnail missing in wp_posts' AS problem
FROM wp_posts p
JOIN wp_postmeta t ON t.post_id = p.ID AND t.meta_key = '_thumbnail_id'
LEFT JOIN wp_posts a ON a.ID = t.meta_value
WHERE p.post_type = 'product' AND a.ID IS NULL
UNION ALL
SELECT p.ID, p.post_status, p.post_title, NULL, 'no featured image'
FROM wp_posts p
LEFT JOIN wp_postmeta t ON t.post_id = p.ID AND t.meta_key = '_thumbnail_id'
WHERE p.post_type = 'product' AND p.post_status IN ('publish', 'draft', 'pending', 'private')
  AND (t.meta_value IS NULL OR t.meta_value IN ('', '0'));


-- -----------------------------------------------------------------------------
-- 12. Product gallery lists (check for IDs that no longer exist in the app layer)
-- -----------------------------------------------------------------------------
SELECT p.ID, p.post_status, p.post_title, g.meta_value AS gallery_ids
FROM wp_posts p
JOIN wp_postmeta g ON g.post_id = p.ID AND g.meta_key = '_product_image_gallery'
WHERE p.post_type = 'product' AND g.meta_value <> ''
ORDER BY p.ID;


-- -----------------------------------------------------------------------------
-- 13. wc_product_meta_lookup drift (table used by shop filters, sorting, stock)
-- -----------------------------------------------------------------------------
SELECT 'published product missing in lookup' AS check_name, p.ID, p.post_title
FROM wp_posts p
LEFT JOIN wp_wc_product_meta_lookup l ON l.product_id = p.ID
WHERE p.post_type IN ('product', 'product_variation') AND p.post_status = 'publish' AND l.product_id IS NULL
UNION ALL
SELECT 'lookup row for deleted post', l.product_id, NULL
FROM wp_wc_product_meta_lookup l
LEFT JOIN wp_posts p ON p.ID = l.product_id
WHERE p.ID IS NULL;

SELECT p.ID, p.post_title,
       l.sku AS lookup_sku, sku.meta_value AS meta_sku,
       l.stock_quantity AS lookup_stock, stk.meta_value AS meta_stock,
       l.stock_status AS lookup_status, sts.meta_value AS meta_status
FROM wp_posts p
JOIN wp_wc_product_meta_lookup l ON l.product_id = p.ID
LEFT JOIN wp_postmeta sku ON sku.post_id = p.ID AND sku.meta_key = '_sku'
LEFT JOIN wp_postmeta stk ON stk.post_id = p.ID AND stk.meta_key = '_stock'
LEFT JOIN wp_postmeta sts ON sts.post_id = p.ID AND sts.meta_key = '_stock_status'
WHERE p.post_type IN ('product', 'product_variation')
  AND (COALESCE(l.sku, '') <> COALESCE(sku.meta_value, '')
       OR COALESCE(l.stock_status, '') <> COALESCE(sts.meta_value, '')
       OR COALESCE(l.stock_quantity, -999999) <> COALESCE(CAST(stk.meta_value AS DECIMAL(19,4)), -999999));


-- -----------------------------------------------------------------------------
-- 14. Stock configuration of every published product
-- -----------------------------------------------------------------------------
SELECT p.ID, p.post_title,
       ms.meta_value AS manage_stock, sq.meta_value AS stock_qty, ss.meta_value AS stock_status,
       bo.meta_value AS backorders, lsa.meta_value AS low_stock_amount
FROM wp_posts p
LEFT JOIN wp_postmeta ms  ON ms.post_id  = p.ID AND ms.meta_key  = '_manage_stock'
LEFT JOIN wp_postmeta sq  ON sq.post_id  = p.ID AND sq.meta_key  = '_stock'
LEFT JOIN wp_postmeta ss  ON ss.post_id  = p.ID AND ss.meta_key  = '_stock_status'
LEFT JOIN wp_postmeta bo  ON bo.post_id  = p.ID AND bo.meta_key  = '_backorders'
LEFT JOIN wp_postmeta lsa ON lsa.post_id = p.ID AND lsa.meta_key = '_low_stock_amount'
WHERE p.post_type = 'product' AND p.post_status = 'publish'
ORDER BY ss.meta_value, p.ID;


-- -----------------------------------------------------------------------------
-- 15. Taxonomy terms with zero published products, and what still uses them
-- -----------------------------------------------------------------------------
SELECT tt.taxonomy, t.term_id, t.name, tt.count,
       GROUP_CONCAT(CONCAT(p.ID, ':', p.post_status) ORDER BY p.ID SEPARATOR ', ') AS linked_posts
FROM wp_term_taxonomy tt
JOIN wp_terms t ON t.term_id = tt.term_id
LEFT JOIN wp_term_relationships tr ON tr.term_taxonomy_id = tt.term_taxonomy_id
LEFT JOIN wp_posts p ON p.ID = tr.object_id
WHERE tt.taxonomy IN ('product_cat', 'product_tag', 'product_brand') AND tt.count = 0
GROUP BY tt.term_taxonomy_id
ORDER BY tt.taxonomy, t.name;


-- -----------------------------------------------------------------------------
-- 16. Order history pointing to products that were deleted
--     (delete + recreate breaks sales history, reports and reviews)
-- -----------------------------------------------------------------------------
-- HPOS / analytics lookup table:
SELECT l.product_id, COUNT(*) AS order_lines, MIN(l.date_created) AS first_sale, MAX(l.date_created) AS last_sale
FROM wp_wc_order_product_lookup l
LEFT JOIN wp_posts p ON p.ID = l.product_id
WHERE p.ID IS NULL
GROUP BY l.product_id
ORDER BY order_lines DESC;

-- Legacy order item meta:
SELECT oim.meta_value AS product_id, COUNT(*) AS order_lines
FROM wp_woocommerce_order_itemmeta oim
LEFT JOIN wp_posts p ON p.ID = oim.meta_value
WHERE oim.meta_key = '_product_id' AND p.ID IS NULL
GROUP BY oim.meta_value
ORDER BY order_lines DESC;


-- -----------------------------------------------------------------------------
-- 17. Who creates, edits, drafts and trashes products
-- -----------------------------------------------------------------------------
SELECT p.post_status, u.user_login AS author, COUNT(*) AS n
FROM wp_posts p
LEFT JOIN wp_users u ON u.ID = p.post_author
WHERE p.post_type = 'product'
GROUP BY p.post_status, u.user_login
ORDER BY n DESC;

SELECT u.user_login AS last_editor, p.post_status, COUNT(*) AS n
FROM wp_postmeta pm
JOIN wp_posts p ON p.ID = pm.post_id
LEFT JOIN wp_users u ON u.ID = pm.meta_value
WHERE pm.meta_key = '_edit_last' AND p.post_type = 'product'
GROUP BY u.user_login, p.post_status
ORDER BY n DESC;


-- -----------------------------------------------------------------------------
-- 18. Emoji inside product titles, descriptions and short descriptions
--     (MariaDB REGEXP uses PCRE; requires utf8mb4 columns)
-- -----------------------------------------------------------------------------
SELECT ID, post_status, post_title,
       (post_title   REGEXP '[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}]') AS emoji_in_title,
       (post_content REGEXP '[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}]') AS emoji_in_description,
       (post_excerpt REGEXP '[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}]') AS emoji_in_short_description
FROM wp_posts
WHERE post_type = 'product' AND post_status NOT IN ('auto-draft')
ORDER BY ID;


-- -----------------------------------------------------------------------------
-- 19. Database weight: revisions, auto-drafts, trash, transients, action scheduler
-- -----------------------------------------------------------------------------
SELECT 'revisions' AS item, COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision'
UNION ALL SELECT 'auto-drafts (IDs reserved by "Add new" clicks)', COUNT(*) FROM wp_posts WHERE post_status = 'auto-draft'
UNION ALL SELECT 'trash (all types)', COUNT(*) FROM wp_posts WHERE post_status = 'trash'
UNION ALL SELECT 'transients', COUNT(*) FROM wp_options WHERE option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%'
UNION ALL SELECT 'autoloaded options (KB)', ROUND(SUM(LENGTH(option_value)) / 1024) FROM wp_options WHERE autoload IN ('yes', 'on', 'auto', 'auto-on');

SELECT status, COUNT(*) AS n FROM wp_actionscheduler_actions GROUP BY status;
SELECT COUNT(*) AS action_scheduler_log_rows FROM wp_actionscheduler_logs;

SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY (data_length + index_length) DESC
LIMIT 25;


-- -----------------------------------------------------------------------------
-- 20. Orders consuming post IDs (HPOS placeholders or legacy orders)
-- -----------------------------------------------------------------------------
SELECT post_type, post_status, COUNT(*) AS n, MIN(ID) AS min_id, MAX(ID) AS max_id
FROM wp_posts
WHERE post_type IN ('shop_order', 'shop_order_placehold', 'shop_order_refund')
GROUP BY post_type, post_status;


-- -----------------------------------------------------------------------------
-- 21. Full product export for reconciliation (all statuses except auto-draft)
-- -----------------------------------------------------------------------------
SELECT p.ID, p.post_status, p.post_date, p.post_modified, p.post_name, p.post_title,
       MAX(CASE WHEN pm.meta_key = '_sku'                   THEN pm.meta_value END) AS sku,
       MAX(CASE WHEN pm.meta_key = '_regular_price'         THEN pm.meta_value END) AS regular_price,
       MAX(CASE WHEN pm.meta_key = '_sale_price'            THEN pm.meta_value END) AS sale_price,
       MAX(CASE WHEN pm.meta_key = '_stock'                 THEN pm.meta_value END) AS stock,
       MAX(CASE WHEN pm.meta_key = '_stock_status'          THEN pm.meta_value END) AS stock_status,
       MAX(CASE WHEN pm.meta_key = '_weight'                THEN pm.meta_value END) AS weight,
       MAX(CASE WHEN pm.meta_key = '_length'                THEN pm.meta_value END) AS length,
       MAX(CASE WHEN pm.meta_key = '_width'                 THEN pm.meta_value END) AS width,
       MAX(CASE WHEN pm.meta_key = '_height'                THEN pm.meta_value END) AS height,
       MAX(CASE WHEN pm.meta_key = '_thumbnail_id'          THEN pm.meta_value END) AS thumbnail_id,
       MAX(CASE WHEN pm.meta_key = '_product_image_gallery' THEN pm.meta_value END) AS gallery_ids,
       MAX(CASE WHEN pm.meta_key = '_global_unique_id'      THEN pm.meta_value END) AS gtin,
       MAX(CASE WHEN pm.meta_key = '_dp_original'           THEN pm.meta_value END) AS cloned_from,
       CHAR_LENGTH(p.post_content) AS description_chars,
       CHAR_LENGTH(p.post_excerpt) AS short_description_chars
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON pm.post_id = p.ID
WHERE p.post_type = 'product' AND p.post_status <> 'auto-draft'
GROUP BY p.ID
ORDER BY p.ID;
