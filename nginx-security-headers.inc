# Included at server level and in every location that sets its own add_header (nginx does not inherit add_header into
# a location that defines any). The app is never embedded, sniffed, or meant to leak full URLs to other sites.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
