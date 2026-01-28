<?php
/**
 * Plugin Name: Dummy Plugin for Repo Tests
 * Description: Test fixture plugin for krokedil-wp-ci scripts and local e2e runs.
 * Version: 0.0.0
 * Author: Krokedil (fixture)
 * Requires Plugins: woocommerce
 */

// Intentionally minimal.

add_action( 'admin_menu', function () {
	add_options_page(
		'Dummy Plugin for Repo Tests Settings',
		'Dummy Plugin (Fixture)',
		'manage_options',
		'dummy-plugin-for-repo-tests',
		function () {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}

			echo '<div class="wrap">';
			echo '<h1>' . esc_html__( 'Dummy Plugin for Repo Tests Settings', 'dummy-plugin-for-repo-tests' ) . '</h1>';
			echo '</div>';
		}
	);
} );
