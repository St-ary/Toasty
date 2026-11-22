# Keep the autofill service and JS bridge reachable.
-keep class lol.stary.toasty.MainActivity$Bridge { *; }
-keep class lol.stary.toasty.autofill.** { *; }
