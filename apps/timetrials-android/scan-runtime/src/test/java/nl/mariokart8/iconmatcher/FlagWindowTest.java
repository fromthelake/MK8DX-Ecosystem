package nl.mariokart8.iconmatcher;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Same synthetic vectors as python/tests/test_flag_window.py and ts/sharedFlagWindow.test.mjs. */
public class FlagWindowTest {
    @Test
    public void theBorderInsetFollowsTheSlotHeight() {
        assertEquals(2, FlagWindow.inset(38));
        assertEquals(2, FlagWindow.inset(20));
        assertEquals(4, FlagWindow.inset(64));
    }

    @Test
    public void aBetterInsetPositionWinsAndATightFullSlotStays() {
        FlagWindow.Read got = FlagWindow.search(65, 48, new int[]{5, 5, 55, 38}, (l, t, w, h) ->
                0.9 - 0.01 * Math.abs(l - 11) - 0.015 * Math.abs(t - 3) + ((l * 7 + t * 13) % 5) * 0.0005
                        - (w == 55 ? 0.05 : 0));
        assertArrayEquals(new int[]{7, 3, 51, 34}, got.cropXywh);
        assertEquals("window_search", got.basis);
        assertEquals(117, got.evaluated);
        assertEquals(0.8615, got.score, 1e-9);
        FlagWindow.Read stay = FlagWindow.search(65, 48, new int[]{5, 5, 55, 38}, (l, t, w, h) ->
                0.8 - 0.02 * Math.abs(l - 5) - 0.02 * Math.abs(t - 5) + (w == 55 ? 0.01 : 0));
        assertArrayEquals(new int[]{5, 5, 55, 38}, stay.cropXywh);
        assertEquals("fixed_slot", stay.basis);
        assertEquals(113, stay.evaluated);
    }
}
