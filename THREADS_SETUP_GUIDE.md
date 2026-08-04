# Threads API Setup Guide

This guide describes how to configure Meta Threads API credentials for the Ba Post Planner.

## Step 1: Create a Meta Developer Account
1. Go to the [Meta for Developers Portal](https://developers.facebook.com/).
2. Log in with your Facebook account and complete the developer registration if you haven't already.

## Step 2: Create a Meta App
1. Click **My Apps** in the top navigation bar.
2. Click **Create App**.
3. Select **Other** as the app type and click **Next**.
4. Select **App Type**:
   * Choose **Business** (recommended if you plan to request public permissions later) or **Consumer**.
5. Fill in your App Name (e.g. `Ba Post Planner`) and contact email.
6. Click **Create App**.

## Step 3: Add Threads Product to Your App
1. Scroll down to the list of products and locate **Threads**.
2. Click **Set Up** to add the Threads product to your application.
3. In the Threads settings menu on the left:
   * Under **App Settings**, add the `threads_basic` and `threads_content_publish` permissions. If you want insights/metrics, add `threads_manage_insights` as well.
   * Configure a Redirect URI (e.g., `https://localhost:3000/oauth-callback` or a simple website if doing manual exchange).

## Step 4: Obtain a Short-Lived Access Token
The easiest way for a single user/admin is to use the **Graph API Explorer** or perform a manual OAuth flow:
1. Go to the Graph API Explorer.
2. In the top-right dropdown, select your newly created Meta App.
3. Under **User or Page**, select **Threads User Token**.
4. In the permissions dropdown, select:
   * `threads_basic`
   * `threads_content_publish`
   * `threads_manage_insights`
5. Click **Generate Access Token**.
6. Meta will prompt you to log in to your Threads account and authorize the application.
7. Copy the generated **Short-Lived Access Token**.

## Step 5: Exchange for a Long-Lived Access Token
Short-lived tokens expire in a few hours. You need to exchange it for a **Long-Lived Access Token** (valid for 60 days):
Make an HTTP GET request (you can do this via curl, Postman, or your browser):

```bash
curl -X GET "https://graph.threads.net/access_token\
  ?grant_type=th_exchange_token\
  &client_secret={your-meta-app-secret}\
  &access_token={your-short-lived-token}"
```

**Note:** You can find `{your-meta-app-secret}` in the Meta Developer Console under **App Settings > Basic**.

This request will return a JSON response:
```json
{
  "access_token": "{your-long-lived-access-token}",
  "token_type": "bearer",
  "expires_in": 5183999
}
```
Copy this `{your-long-lived-access-token}`.

## Step 6: Get Your Threads User ID
Make a request to the `/me` endpoint using your long-lived token:
```bash
curl -X GET "https://graph.threads.net/v1.0/me?fields=id,username&access_token={your-long-lived-token}"
```
This returns:
```json
{
  "id": "123456789012345",
  "username": "your_threads_handle"
}
```
Copy the `id` (this is your Threads User ID).

## Step 7: Configure inside Ba Post Planner
1. Open the Ba Post Planner UI.
2. Navigate to **Settings > Channels**.
3. Select **Threads** from the platform dropdown.
4. Input:
   * **Name**: Any name (e.g. `My Threads account`)
   * **Channel ID**: Your Threads User ID (from Step 6)
   * **API Key / Token**: Your Long-Lived Access Token (from Step 5)
5. Save the channel.
