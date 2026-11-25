package com.jarvis.android

import org.junit.Assert.assertEquals
import org.junit.Test

class AttributionTest {
    @Test fun nameAndRepoMatchPermission() {
        assertEquals("JARVIS for Android", Attribution.APP_NAME)
        assertEquals("https://github.com/Nullzedz/jarvis", Attribution.REPO_URL)
    }
}
