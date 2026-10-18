package com.dsh.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// DeepSeek-inspired palette: deep blue-violet primary, warm accents.
private val DeepPurple = Color(0xFF7C5CFF)
private val DeepBlue = Color(0xFF4D6BFE)
private val Ink = Color(0xFF0E1116)
private val InkElevated = Color(0xFF171B23)
private val Slate = Color(0xFF9AA4B2)
private val WarmAccent = Color(0xFFF5B14C)

private val DarkColors = darkColorScheme(
    primary = DeepPurple,
    secondary = DeepBlue,
    tertiary = WarmAccent,
    background = Ink,
    surface = InkElevated,
    surfaceVariant = Color(0xFF1E242E),
    onBackground = Color(0xFFE8EBF2),
    onSurface = Color(0xFFE8EBF2),
    onSurfaceVariant = Slate,
    error = Color(0xFFFF6B6B),
)

private val LightColors = lightColorScheme(
    primary = DeepPurple,
    secondary = DeepBlue,
    tertiary = WarmAccent,
)

@Composable
fun DSHTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
