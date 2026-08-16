import type { Fixture } from "../types.js";

/**
 * The real fixture set.
 *
 * Every expectation was written by reading the source, not by running an extractor over it — an
 * expected output copied from what an extractor produced measures agreement with today's bugs.
 *
 * URL fixtures state **no sections**: JSON-LD's `recipeIngredient` is a flat array and cannot
 * express them (decisions §45), so expecting them would score tier 0 against the capture format
 * rather than against itself. Captions do carry sections, because their headings are in the text.
 */

export const budgetbytes_pesto_pasta: Fixture = {
  id: "budgetbytes-pesto-pasta",
  input: {
    kind: "url",
    url: "https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>One Pot Creamy Pesto Chicken Pasta</h1>\n<script type=\"application/ld+json\">\n{\n \"@type\": \"Recipe\",\n \"name\": \"One Pot Creamy Pesto Chicken Pasta\",\n \"author\": {\n  \"@id\": \"https://www.budgetbytes.com/#/schema/person/de533a4dad507aefcf8ea04e131701f9\"\n },\n \"description\": \"This super lush and Creamy Pesto Chicken Pasta is perfect for busy weeknights. Everything cooks in one pot and is done in under 30 minutes! \",\n \"datePublished\": \"2025-01-09T08:30:00+00:00\",\n \"image\": [\n  \"https://www.budgetbytes.com/wp-content/uploads/2019/10/Creamy-Pesto-Chicken-Pasta-close-plate.jpg\",\n  \"https://www.budgetbytes.com/wp-content/uploads/2019/10/Creamy-Pesto-Chicken-Pasta-close-plate-500x500.jpg\",\n  \"https://www.budgetbytes.com/wp-content/uploads/2019/10/Creamy-Pesto-Chicken-Pasta-close-plate-500x375.jpg\",\n  \"https://www.budgetbytes.com/wp-content/uploads/2019/10/Creamy-Pesto-Chicken-Pasta-close-plate-480x270.jpg\"\n ],\n \"video\": {\n  \"name\": \"One Pot Creamy Pesto Chicken Pasta\",\n  \"description\": \"This super lush and Creamy Pesto Chicken Pasta is perfect for busy weeknights. Everything cooks in one pot and is done in under 30 minutes! FULL RECIPE BELOW. 👇\\n\\nPRINTABLE RECIPE: https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/\\n\\nINGREDIENTS\\n1 lb. boneless, skinless chicken breast ($5.56)\\n2 Tbsp butter ($0.26)\\n2 cloves garlic ($0.16)\\n1/2 lb. penne pasta ($0.40)\\n1.5 cups chicken broth ($0.20)\\n1 cup milk ($0.32)\\n3 oz. cream cheese ($0.29)\\n1/3 cup basil pesto ($0.73)\\n1/4 cup grated Parmesan ($0.44)\\nfreshly cracked pepper ($0.03)\\n1 pinch crushed red pepper ($0.02)\\nOPTIONAL ADD-INS\\n3 cup fresh spinach ($0.90)\\n1/4 cup sliced sun dried tomatoes ($1.10)\\n\\nINSTRUCTIONS\\n1. Cut the chicken breast into 1-inch pieces. Add the butter to a deep skillet and melt over medium heat. Add the chicken to the skillet and cook over medium heat until the chicken is slightly browned on the outside.\\n2. While the chicken is cooking, mince the garlic. Add the garlic to the skillet with the chicken and continue to sauté for one minute more.\\n3. Add the uncooked pasta and chicken broth to the skillet with the chicken and garlic. Stir to dissolve any browned bits from the bottom of the skillet. Place a lid on the skillet, turn the heat up to medium-high, and bring the broth up to a boil.\\n4. Once the broth comes to a full boil, give the pasta a quick stir, replace the lid, and turn the heat down to medium-low. Let the pasta simmer over medium-low heat for about 8 minutes, or until the pasta is tender and most of the broth has been absorbed. Stir the pasta briefly every two minutes as it simmers, replacing the lid quickly each time.\\n5. Once the pasta is tender and most of the broth absorbed, add the milk, cream cheese (cut into chunks), and pesto. Stir and cook over medium heat until the cream cheese has fully melted into the sauce. Finally, add the grated Parmesan and stir until combined.\\n6. If using, add the fresh spinach and sliced sun dried tomatoes. Stir until the spinach has wilted, then remove the pasta from the heat. Top the pasta with freshly cracked pepper and a pinch of crushed red pepper, then serve.\\n\\nSee how we calculate recipe costs here: https://www.budgetbytes.com/how-to-calculate-recipe-costs/\\n\\nInstagram: budgetbytes\\nFacebook: budgetbytes1\\nPinterest: budgetbytes\\nTwitter: budget_bytes\\n\\nTIMESTAMPS\\n0:00 Introduction\\n0:09 Sauté Chicken in Butter\\n0:14 Add Minced Garlic\\n0:17 Add Pasta and Broth\\n0:24 Simmer\\n0:31 Stir in Cream Cheese, Pesto, and Milk\\n0:43 Add Parmesan\\n0:47 Season with Pepper and Crushed Red Pepper\\n0:49 Fold in Sun Dried Tomatoes and Spinach\\n1:00 Serve and Enjoy!\",\n  \"uploadDate\": \"2020-12-06T16:30:02+00:00\",\n  \"duration\": \"PT1M8S\",\n  \"thumbnailUrl\": \"https://i.ytimg.com/vi/cxTSOlWNXy0/hqdefault.jpg\",\n  \"embedUrl\": \"https://www.youtube.com/embed/cxTSOlWNXy0?feature=oembed\",\n  \"contentUrl\": \"https://www.youtube.com/watch?v=cxTSOlWNXy0\",\n  \"@type\": \"VideoObject\"\n },\n \"recipeYield\": [\n  \"4\"\n ],\n \"prepTime\": \"PT5M\",\n \"cookTime\": \"PT20M\",\n \"totalTime\": \"PT25M\",\n \"recipeIngredient\": [\n  \"1 lb. boneless, skinless chicken breast ($6.25)\",\n  \"2 Tbsp butter ($0.28)\",\n  \"2 cloves garlic ($0.16)\",\n  \"1/2 lb. penne pasta ($0.67)\",\n  \"1.5 cups chicken broth ($0.20)\",\n  \"1 cup milk ($0.19)\",\n  \"3 oz. cream cheese* ($0.80)\",\n  \"1/3 cup basil pesto ($0.73)\",\n  \"1/4 cup grated Parmesan ($0.44)\",\n  \"freshly cracked pepper ($0.03)\",\n  \"1 pinch  crushed red pepper ($0.02)\",\n  \"3 cup fresh spinach ($0.90)\",\n  \"1/4 cup sliced sun dried tomatoes ($1.10)\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Cut the chicken breast into 1-inch pieces. Add the butter to a deep skillet and melt over medium heat. Add the chicken to the skillet and cook over medium heat until the chicken is slightly browned on the outside.\",\n   \"name\": \"Cut the chicken breast into 1-inch pieces. Add the butter to a deep skillet and melt over medium heat. Add the chicken to the skillet and cook over medium heat until the chicken is slightly browned on the outside.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-0\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"While the chicken is cooking, mince the garlic. Add the garlic to the skillet with the chicken and continue to sauté for one minute more.\",\n   \"name\": \"While the chicken is cooking, mince the garlic. Add the garlic to the skillet with the chicken and continue to sauté for one minute more.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-1\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Add the uncooked pasta and chicken broth to the skillet with the chicken and garlic. Stir to dissolve any browned bits from the bottom of the skillet. Place a lid on the skillet, turn the heat up to medium-high, and bring the broth up to a boil.\",\n   \"name\": \"Add the uncooked pasta and chicken broth to the skillet with the chicken and garlic. Stir to dissolve any browned bits from the bottom of the skillet. Place a lid on the skillet, turn the heat up to medium-high, and bring the broth up to a boil.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-2\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Once the broth comes to a full boil, give the pasta a quick stir, replace the lid, and turn the heat down to medium-low. Let the pasta simmer over medium-low heat for about 8 minutes, or until the pasta is tender and most of the broth has been absorbed. Stir the pasta briefly every two minutes as it simmers, replacing the lid quickly each time.\",\n   \"name\": \"Once the broth comes to a full boil, give the pasta a quick stir, replace the lid, and turn the heat down to medium-low. Let the pasta simmer over medium-low heat for about 8 minutes, or until the pasta is tender and most of the broth has been absorbed. Stir the pasta briefly every two minutes as it simmers, replacing the lid quickly each time.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-3\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Once the pasta is tender and most of the broth absorbed, add the milk, cream cheese (cut into chunks), and pesto. Stir and cook over medium heat until the cream cheese has fully melted into the sauce. Finally, add the grated Parmesan and stir until combined.\",\n   \"name\": \"Once the pasta is tender and most of the broth absorbed, add the milk, cream cheese (cut into chunks), and pesto. Stir and cook over medium heat until the cream cheese has fully melted into the sauce. Finally, add the grated Parmesan and stir until combined.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-4\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"If using, add the fresh spinach and sliced sun dried tomatoes. Stir until the spinach has wilted, then remove the pasta from the heat. Top the pasta with freshly cracked pepper and a pinch of crushed red pepper, then serve.\",\n   \"name\": \"If using, add the fresh spinach and sliced sun dried tomatoes. Stir until the spinach has wilted, then remove the pasta from the heat. Top the pasta with freshly cracked pepper and a pinch of crushed red pepper, then serve.\",\n   \"url\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#wprm-recipe-45797-step-0-5\"\n  }\n ],\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"ratingValue\": \"4.84\",\n  \"ratingCount\": \"254\",\n  \"reviewCount\": \"14\"\n },\n \"review\": [\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"4\"\n   },\n   \"reviewBody\": \"I think I will use chicken thighs instead of breast next time as thighs can stand up to the cooking times and still be more juicy than chicken breast. Otherwise, my family loved it especially the sauce. Thank you.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Angela Jones\"\n   },\n   \"datePublished\": \"2026-08-10\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"1\"\n   },\n   \"reviewBody\": \"This recipe was not good for me. I would do it completely different next time. I would cook the chicken with only a small amount of oil in the cast iron to get it browned on high, and cook the noodles separately. There was not enough broth to cook the noodles, I had to add more, and then I had to cut back in milk. Doubled the pesto and cheese to make it thicker. In the end the chicken was basically boiled and overcooked.\\r\\n\\r\\nDisappointing recipe. :/\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Lilli\"\n   },\n   \"datePublished\": \"2026-08-04\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This was delicious! I added extra garlic and I didn’t have tomatoes or spinach on hand so I used canned artichokes instead. Next time I’ll cook as directed! Wonderful recipe!!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kristen\"\n   },\n   \"datePublished\": \"2026-06-26\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I just made this for the second time.  We love it.  Second time I didn't have cream cheese but used heavy cream and it turned out great.  This will be on rotation.  Quick and easy.  It's also a great way to use up homemade pesto.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kathleen Schwendeman\"\n   },\n   \"datePublished\": \"2026-04-27\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This was delicious! A really yummy, easy, one pot recipe that comes together really nicely. Make sure you get a good quality basil pesto as I think that makes a big difference. I also used half a cup more chicken stock and a bit more pasta.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Brooke\"\n   },\n   \"datePublished\": \"2026-04-27\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I love this recipe, I don't add the milk, but use garlic and herb cream cheese, copious amounts of it. Always double the pesto and parmesan, spinach and sun-dried tomatoes. It's a winner iny house, one pan dinners are my absolute favourite, much less washing up than a roast dinner. Thankyou for posting this, I have printed and laminated your recipe and it's become extremely popular with the girls at work. UK fan here, I will be trying your other recipes\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Yve\"\n   },\n   \"datePublished\": \"2026-04-12\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Made this last night for supper. My family really enjoyed it and there were no leftovers. I used homemade garlic chive pesto and homemade sundried tomatoes. It was really quick as well.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jerilea\"\n   },\n   \"datePublished\": \"2026-03-03\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This was a hit, I added just a little rotisserie chicken seasoning to my chicken while it was cooking. Thanks for another great recipe to add to our meal plan!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kirsten\"\n   },\n   \"datePublished\": \"2026-02-26\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Bless you for this recipe. My teenage son requested this in our regular rotation. Delicious! I always double this and sub the spinach for the \\\"power greens\\\" mix and have enough for a few days at least.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Aileen D\"\n   },\n   \"datePublished\": \"2026-02-19\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This was genuinely amazing like 11/10 my favorite pasta ever!!!’nn\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jacob Winans\"\n   },\n   \"datePublished\": \"2026-01-14\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"made this and love it!!!\\r\\nI accidentally bought roasted red peppers so I just used them and it was absolutely delicious!\\r\\nThe next day i decided to make it again , so it  can have lunches for the coming week. I used the sun dried tomatoes &amp; I got to say I liked the prepped better but it was still delicious!\\r\\nOne of my new favorites!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Delilah Bell\"\n   },\n   \"datePublished\": \"2025-11-02\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Made this with protein (chickpea) Farfalle noodles and it turned out fantastic!  Farfalle needs a couple extra minutes to become tender in the middle so use a “heaping” 1.5 cups of broth.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Hunter\"\n   },\n   \"datePublished\": \"2025-10-07\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I have a question! I only have frozen spinach. Should I I thaw it, drain it and then add to this recipe?\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Esther Tolooei\"\n   },\n   \"datePublished\": \"2025-09-23\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Hi Beth! I made this recipe tonight and it is phenomenal, I'm just starting to learn to cook on my own and this was both easy and delicious. My sauce was VERY runny, I think a product of using bouillon over real broth. I'll reduce the amount next time and see how it goes. Thanks again for posting this!!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Zachary Aaron Taylor\"\n   },\n   \"datePublished\": \"2025-08-31\"\n  }\n ],\n \"recipeCategory\": [\n  \"Dinner\",\n  \"Main Course\"\n ],\n \"recipeCuisine\": [\n  \"American\"\n ],\n \"keywords\": \"Easy Dinner, Weeknight Recipe\",\n \"nutrition\": {\n  \"@type\": \"NutritionInformation\",\n  \"servingSize\": \"1 Serving\",\n  \"calories\": \"748.68 kcal\",\n  \"carbohydrateContent\": \"52.55 g\",\n  \"proteinContent\": \"41.75 g\",\n  \"fatContent\": \"41.53 g\",\n  \"fiberContent\": \"4.1 g\",\n  \"sodiumContent\": \"1099.28 mg\"\n },\n \"@id\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#recipe\",\n \"isPartOf\": {\n  \"@id\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/#article\"\n },\n \"mainEntityOfPage\": \"https://www.budgetbytes.com/one-pot-creamy-pesto-chicken-pasta/\"\n}\n</script>\n<ul class=\"ingredients\">\n  <li class=\"ingredient\">▢ 1 lb. ( 450 g ) boneless, skinless chicken breast ($6.25)</li>\n  <li class=\"ingredient\">▢ 2 Tbsp ( 30 g ) butter ($0.28)</li>\n  <li class=\"ingredient\">▢ 2 cloves garlic ($0.16)</li>\n  <li class=\"ingredient\">▢ 1/2 lb. ( 230 g ) penne pasta ($0.67)</li>\n  <li class=\"ingredient\">▢ 1.5 cups ( 350 ml ) chicken broth ($0.20)</li>\n  <li class=\"ingredient\">▢ 1 cup ( 240 ml ) milk ($0.19)</li>\n  <li class=\"ingredient\">▢ 3 oz. ( 90 g ) cream cheese* ($0.80)</li>\n  <li class=\"ingredient\">▢ 1/3 cup ( 80 g ) basil pesto ($0.73)</li>\n  <li class=\"ingredient\">▢ 1/4 cup ( 25 g ) grated Parmesan ($0.44)</li>\n  <li class=\"ingredient\">▢ freshly cracked pepper ($0.03)</li>\n  <li class=\"ingredient\">▢ 1 pinch crushed red pepper ($0.02)</li>\n  <li class=\"ingredient\">▢ 3 cup ( 90 g ) fresh spinach ($0.90)</li>\n  <li class=\"ingredient\">▢ 1/4 cup ( 30 g ) sliced sun dried tomatoes ($1.10)</li>\n</ul>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "One Pot Creamy Pesto Chicken Pasta",
      servings: 4,
      totalMinutes: 25,
      ingredients: [
        { amount: 1, unit: "lb", item: "boneless, skinless chicken breast" },
        { amount: 2, unit: "tbsp", item: "butter" },
        { amount: 2, unit: "clove", item: "garlic" },
        { amount: 0.5, unit: "lb", item: "penne pasta" },
        { amount: 1.5, unit: "cup", item: "chicken broth" },
        { amount: 1, unit: "cup", item: "milk" },
        { amount: 3, unit: "oz", item: "cream cheese" },
        { amount: 0.333, unit: "cup", item: "basil pesto" },
        { amount: 0.25, unit: "cup", item: "grated Parmesan" },
        { amount: null, unit: null, item: "freshly cracked pepper" },
        { amount: null, unit: null, item: "crushed red pepper" },
        { amount: 3, unit: "cup", item: "fresh spinach" },
        { amount: 0.25, unit: "cup", item: "sliced sun dried tomatoes" },
      ],
    },
  },
};

export const pinchofyum_gochujang_noodles: Fixture = {
  id: "pinchofyum-gochujang-noodles",
  input: {
    kind: "url",
    url: "https://pinchofyum.com/saucy-gochujang-noodles-with-chicken",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>Saucy Gochujang Noodles with Chicken</h1>\n<script type=\"application/ld+json\">\n{\n \"@context\": \"https://schema.org/\",\n \"@type\": \"Recipe\",\n \"name\": \"Saucy Gochujang Noodles with Chicken\",\n \"description\": \"Spicy, peanutty, noodley bit of super easy comfort food coming your way! These gochujang noodles require just a handful of pantry ingredients - like ramen noodles, peanut butter, sesame oil, soy sauce, and more - and come together in just 20 mins. Weeknight win!\",\n \"author\": {\n  \"@type\": \"Person\",\n  \"name\": \"Lindsay Ostrom\",\n  \"url\": \"https://pinchofyum.com/about\"\n },\n \"keywords\": \"gochujang, noodles, stir fry, ground chicken, spicy noodles, weeknight dinner\",\n \"image\": [\n  \"https://pinchofyum.com/tachyon/Gochujang-Noodles-3-Square.jpg?fit=225%2C225\",\n  \"https://pinchofyum.com/tachyon/Gochujang-Noodles-3-Square.jpg?fit=195%2C195\",\n  \"https://pinchofyum.com/tachyon/Gochujang-Noodles-3-Square.jpg?fit=180%2C180\",\n  \"https://pinchofyum.com/tachyon/Gochujang-Noodles-3-Square.jpg\"\n ],\n \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken\",\n \"recipeIngredient\": [\n  \"3 tablespoons soy sauce\",\n  \"2-3 tablespoons gochujang sauce (like this one (affiliate link))\",\n  \"2 tablespoons tomato paste\",\n  \"2 tablespoons peanut butter\",\n  \"2 tablespoons water\",\n  \"1-2 tablespoons brown sugar\",\n  \"1 tablespoon sesame oil\",\n  \"1 clove minced garlic\",\n  \"1-2 cups broth or water for thinning the sauce\",\n  \"1 pound ground chicken (could also use pork)\",\n  \"1/2 teaspoon salt\",\n  \"freshly ground black pepper\",\n  \"2 packets ramen or stir fry noodles (just the noodles)\",\n  \"1-2 cups fresh spinach\",\n  \"1/4 cup chives, scallions, cilantro, basil, or whatever herbs you like for topping\",\n  \"salt to taste\",\n  \"1 tablespoon chili oil for finishing\",\n  \"1 tablespoon sesame seeds for finishing\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Whisk the sauce ingredients (except the extra broth) in a small bowl or shake together in a jar. It should form a thick sauce.\",\n   \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#instruction-step-1\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Cook the chicken in a large skillet over medium high heat. Season generously with salt and pepper. \",\n   \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#instruction-step-2\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Boil the noodles for just a few minutes to soften. Drain and set aside.\",\n   \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#instruction-step-3\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"When the chicken is done, add spinach, cooked noodles, and sauce to the pan, keeping it over medium high heat. Toss to combine; heat until the spinach is wilted. Add extra water or broth to thin the sauce, a little at a time, to get the sauciness that you like (I usually add about 1 1/2 cups total). \",\n   \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#instruction-step-4\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Serve topped with fresh herbs, scallions, chili oil, sesame seeds, and whatever else you like. \",\n   \"url\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#instruction-step-5\"\n  }\n ],\n \"prepTime\": \"PT10M\",\n \"cookTime\": \"PT20M\",\n \"totalTime\": \"PT30M\",\n \"recipeYield\": [\n  \"4\",\n  \"4-6 servings\"\n ],\n \"recipeCategory\": \"Dinner\",\n \"cookingMethod\": \"Stovetop\",\n \"recipeCuisine\": \"Korean-Inspired\",\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"reviewCount\": \"134\",\n  \"ratingValue\": \"5\"\n },\n \"nutrition\": {\n  \"servingSize\": null,\n  \"calories\": \"435 calories\",\n  \"sugarContent\": \"7.3 g\",\n  \"sodiumContent\": \"1012.2 mg\",\n  \"fatContent\": \"17.4 g\",\n  \"saturatedFatContent\": \"4 g\",\n  \"transFatContent\": \"0.1 g\",\n  \"carbohydrateContent\": \"41.9 g\",\n  \"fiberContent\": \"2.5 g\",\n  \"proteinContent\": \"28.6 g\",\n  \"cholesterolContent\": \"96.3 mg\",\n  \"@type\": \"nutritionInformation\"\n },\n \"video\": {\n  \"@context\": \"http://schema.org\",\n  \"@type\": \"VideoObject\",\n  \"name\": \"Saucy Gochujang Noodles with Chicken\",\n  \"description\": \"A spicy, peanutty, noodley bit of super easy comfort food! These gochujang noodles require just a handful of ingredients – like ramen noodles, peanut butter, sesame oil, and soy sauce – and come together in just 20 minutes.\",\n  \"contentUrl\": \"https://content.jwplatform.com/videos/A2NutzuP.mp4\",\n  \"thumbnailUrl\": [\n   \"https://content.jwplatform.com/thumbs/A2NutzuP-720.jpg\"\n  ],\n  \"uploadDate\": \"2022-11-15T17:32:50+00:00\"\n },\n \"review\": [\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Josh\"\n   },\n   \"datePublished\": \"2022-06-06\",\n   \"reviewBody\": \"When clicking on the Amazon link, did you use the hot and spicy one or the classic? There are four options to that link. Thanks\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Krista\"\n   },\n   \"datePublished\": \"2024-02-10\",\n   \"reviewBody\": \"This is delicious and easy to make. My ground chicken was frozen but only took a few extra minutes to cook. I am going to be making this regularly.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jan\"\n   },\n   \"datePublished\": \"2024-07-30\",\n   \"reviewBody\": \"Made it for the first time tonight. Really enjoyed it. Perfect amount of spicy. Easy and delicious! My kind of recipe!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"3\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Emily\"\n   },\n   \"datePublished\": \"2026-03-17\",\n   \"reviewBody\": \"I thought there was way too much sauce. Maybe a 3rd package of noodles would have helped, just felt like it was too strong? I guess like too rich, even with the water to thin sauce.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"SV Robinson\"\n   },\n   \"datePublished\": \"2022-06-06\",\n   \"reviewBody\": \"Just made this….just ate this out of the skillet.  Added mushrooms and topped with scallions and sesame seeds.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Tianna\"\n   },\n   \"datePublished\": \"2023-11-28\",\n   \"reviewBody\": \"Love the spice level in this dish.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Sarah\"\n   },\n   \"datePublished\": \"2022-06-06\",\n   \"reviewBody\": \"This was so delicious! I had everything in my pantry so I jumped on this recipe. I had leeks and kale to use up, so I sautéed those in, and had a bit thicker noodle, but in every way, shape and form, I will be making this many times over!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Brenna\"\n   },\n   \"datePublished\": \"2025-12-21\",\n   \"reviewBody\": \"I had some gochujang paste from another recipe you published, so I used that. I have to say, after mixing the sauce up, it was odd tasting, but strangely addictive and interestingly delicious. With the chicken, noodles and herbs? Yummers!! Thanks for another winner!!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Loncy\"\n   },\n   \"datePublished\": \"2022-06-06\",\n   \"reviewBody\": \"Delicious! This recipe was so easy to make and it is amazing. I used sambal since I didn’t have gochujang and skipped the sugar, definitely spicy but still great with the peanut butter and tomato! Next time I’ll add some extra veggies like carrots and mushrooms!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Rita\"\n   },\n   \"datePublished\": \"2022-06-08\",\n   \"reviewBody\": \"Thanks for sharing this recipe!!  Made it with ground pork but would have been great with tofu because the sauce is amazing.  Added broccoli, mushrooms, bell peppers and onions to make it a more balanced meal.  Quick, easy and immensely satisfying.  I'll definitely make this again :)\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Stephanie G\"\n   },\n   \"datePublished\": \"2022-06-11\",\n   \"reviewBody\": \"I made this tonight &amp; LOVED IT. Subbed Pork for the chicken and chili garlic sauce and it was phenomenal. Quick. Insanely flavorful. POY does not disappoint!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"4\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jessica\"\n   },\n   \"datePublished\": \"2022-06-13\",\n   \"reviewBody\": \"Made this last night and it was so good!\\r\\nI used chicken thighs instead of the ground chicken (just because we had them), but honestly think the options for a protein are endless.\\r\\nI bought Gochujang paste, not sure if it's different than the sauce, but with 2tbs it was great.  Definitely spicy, but so good!  I love a good nose sweat when eating spicy food.\\r\\nI feel like the sauce will be a great recipe to have in my pocket as I think it's really versatile.  Was even thinking to use it for cold noodles.\\r\\nYou are my go-to for recipes as they are always delicious and well seasoned, so thank you!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jen M\"\n   },\n   \"datePublished\": \"2022-06-13\",\n   \"reviewBody\": \"I made this gluten free using Lotus ramen noodles (4 squares), Chung Jung One gochujang sauce and tamari.  It was delicious and have to say I think I preferred the leftovers cold right out of the fridge.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Rachel\"\n   },\n   \"datePublished\": \"2022-06-13\",\n   \"reviewBody\": \"This was great! We made it vegetarian by skipping the chicken and adding sugar snap peas, mushrooms and broccoli.  We used the gochujang paste instead of sauce because that's what the grocery store near us had and it was just the right amount of heat. Amazing flavor all around!  Garnished with chives, green onions, sesame seeds and cilantro sprouts.  Totally awesome - thank you!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Char\"\n   },\n   \"datePublished\": \"2022-06-14\",\n   \"reviewBody\": \"This is a good one!  Super easy too!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Sarah\"\n   },\n   \"datePublished\": \"2022-06-16\",\n   \"reviewBody\": \"This was so easy and DELICIOUS. We had it on a weeknight. I was able to find all of the ingredients at our regular big chain grocery store. We'll definitely be enjoying this again soon.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Lori\"\n   },\n   \"datePublished\": \"2022-06-16\",\n   \"reviewBody\": \"These noodles are delicious! I don't eat meat so I added ltos of vegetables, it was a great, quick meal. We are obsessed with gochuchang these days.  The peanut butter made it really creamy but didn't taste overly peanutty!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Anjali\"\n   },\n   \"datePublished\": \"2022-06-16\",\n   \"reviewBody\": \"Thanks for this delicious inspiration! Made with brown rice noodles and garnished with crushed peanuts and lime juice. Household seeks an encore.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Anjali\"\n   },\n   \"datePublished\": \"2022-06-17\",\n   \"reviewBody\": \"Thanks for this delicious recipe! I used brown rice noodles and garnished with lime juice and crushed peanuts. Chef's kiss. My husband asked me to make it again within the same week, which is a high compliment because we like variety!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Amy\"\n   },\n   \"datePublished\": \"2022-06-17\",\n   \"reviewBody\": \"We love Korean flavors at our house so I gave these a try and they were a huge hit. My husband (who doesn't like spicy food) had seconds and my foody teenaged son said these were, \\\"amazing.\\\" Will definitely add this to our meal rotation. Thank you!\"\n  }\n ],\n \"datePublished\": \"2022-06-06\",\n \"@id\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#recipe\",\n \"isPartOf\": {\n  \"@id\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken#article\"\n },\n \"mainEntityOfPage\": \"https://pinchofyum.com/saucy-gochujang-noodles-with-chicken\"\n}\n</script>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Saucy Gochujang Noodles with Chicken",
      servings: 4,
      totalMinutes: 30,
      ingredients: [
        { amount: 3, unit: "tbsp", item: "soy sauce" },
        { amount: 3, unit: "tbsp", item: "gochujang sauce" },
        { amount: 2, unit: "tbsp", item: "tomato paste" },
        { amount: 2, unit: "tbsp", item: "peanut butter" },
        { amount: 2, unit: "tbsp", item: "water" },
        { amount: 2, unit: "tbsp", item: "brown sugar" },
        { amount: 1, unit: "tbsp", item: "sesame oil" },
        { amount: 1, unit: "clove", item: "minced garlic" },
        { amount: 2, unit: "cup", item: "broth or water for thinning the sauce" },
        { amount: 1, unit: "lb", item: "ground chicken" },
        { amount: 0.5, unit: "tsp", item: "salt" },
        { amount: null, unit: null, item: "freshly ground black pepper" },
        { amount: 2, unit: "can", item: "ramen or stir fry noodles" },
        { amount: 2, unit: "cup", item: "fresh spinach" },
        { amount: 0.25, unit: "cup", item: "chives, scallions, cilantro, basil, or whatever herbs you like for topping" },
        { amount: null, unit: null, item: "salt" },
        { amount: 1, unit: "tbsp", item: "chili oil for finishing" },
        { amount: 1, unit: "tbsp", item: "sesame seeds for finishing" },
      ],
    },
  },
};

export const bbcgoodfood_summer_traybake: Fixture = {
  id: "bbcgoodfood-summer-traybake",
  input: {
    kind: "url",
    url: "https://www.bbcgoodfood.com/recipes/summer-roast-chicken-traybake",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>Summer roast chicken traybake</h1>\n<script type=\"application/ld+json\">\n{\n \"@context\": \"https://schema.org\",\n \"@id\": \"https://www.bbcgoodfood.com/recipes/summer-roast-chicken-traybake#Recipe\",\n \"@type\": \"Recipe\",\n \"description\": \"Revamp your roast chicken for the summer months with just a few ingredients. Serve our easy traybake with salad or crusty bread for a winning chicken dinner\",\n \"image\": [\n  {\n   \"@type\": \"ImageObject\",\n   \"url\": \"https://images.immediate.co.uk/production/volatile/sites/30/2020/08/5_ingredients_chicken-384d57e.jpg?resize=440,400\",\n   \"width\": 440,\n   \"height\": 400\n  }\n ],\n \"mainEntityOfPage\": {\n  \"@type\": \"WebPage\",\n  \"@id\": \"https://www.bbcgoodfood.com/recipes/summer-roast-chicken-traybake\"\n },\n \"name\": \"Summer roast chicken traybake\",\n \"url\": \"https://www.bbcgoodfood.com/recipes/summer-roast-chicken-traybake\",\n \"author\": [\n  {\n   \"@type\": \"Person\",\n   \"name\": \"Esther Clark\",\n   \"url\": \"https://www.bbcgoodfood.com/author/estherclark\"\n  }\n ],\n \"dateModified\": \"2026-07-13T16:29:43+01:00\",\n \"datePublished\": \"2019-06-10T20:42:57+01:00\",\n \"headline\": \"Summer roast chicken traybake\",\n \"keywords\": \"Chicken, Esther Clark, Fibre, Folate, Gluten free, Roast chicken, Summer, Traybake\",\n \"publisher\": {\n  \"@type\": \"Organization\",\n  \"name\": \"Good Food\",\n  \"url\": \"https://www.bbcgoodfood.com\",\n  \"logo\": {\n   \"@type\": \"ImageObject\",\n   \"height\": 325,\n   \"url\": \"https://images.immediate.co.uk/production/volatile/sites/30/2026/02/goodfood.logo-f37096c.png?resize=1312,325\",\n   \"width\": 1312\n  }\n },\n \"cookTime\": \"PT1H20M\",\n \"nutrition\": {\n  \"@type\": \"NutritionInformation\",\n  \"calories\": \"550 calories\",\n  \"fatContent\": \"33 grams fat\",\n  \"saturatedFatContent\": \"8 grams saturated fat\",\n  \"carbohydrateContent\": \"22 grams carbohydrates\",\n  \"sugarContent\": \"7 grams sugar\",\n  \"fiberContent\": \"6 grams fiber\",\n  \"proteinContent\": \"37 grams protein\",\n  \"sodiumContent\": \"0.9 milligram of sodium\"\n },\n \"prepTime\": \"PT10M\",\n \"recipeCategory\": \"Dinner, Main course\",\n \"recipeIngredient\": [\n  \"1 ½kg whole chicken\",\n  \"4 tbsp olive oil\",\n  \"600g frozen mixed roasted veg\",\n  \"2 x 400g cans cannellini beans drained and rinsed\",\n  \"145g fresh pesto\",\n  \"400g cherry tomatoes on the vine\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Heat the oven to 190C/170C fan/gas 5. Rub the chicken with the oil, then generously season the skin and inside the cavity with salt and black pepper. Arrange the veg in a large roasting tin and sit the chicken on top. Roast for 1 hr, uncovered.\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Tip the beans and pesto into the tin and stir through the veg. Add 150ml water and arrange the tomatoes over the beans and veg. Return the tin to the oven and cook for a further 20 mins, or until the chicken is cooked through and the juices run clear.\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Remove from the oven, cover loosely with foil and rest for 20 mins before carving and serving.\"\n  }\n ],\n \"recipeYield\": \"Serves 4-6\",\n \"suitableForDiet\": \"https://schema.org/GlutenFreeDiet\",\n \"totalTime\": \"PT1H30M\"\n}\n</script>\n<ul class=\"ingredients\">\n  <li class=\"ingredient\">1 ½kg whole chicken</li>\n  <li class=\"ingredient\">4 tbsp olive oil</li>\n  <li class=\"ingredient\">600g frozen mixed roasted veg</li>\n  <li class=\"ingredient\">2 x 400g cans cannellini beans drained and rinsed</li>\n  <li class=\"ingredient\">145g fresh pesto</li>\n  <li class=\"ingredient\">400g cherry tomatoes on the vine</li>\n</ul>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Summer roast chicken traybake",
      servings: 4,
      totalMinutes: 90,
      ingredients: [
        { amount: 1.5, unit: "kg", item: "whole chicken" },
        { amount: 4, unit: "tbsp", item: "olive oil" },
        { amount: 600, unit: "g", item: "frozen mixed roasted veg" },
        { amount: 800, unit: "g", item: "cannellini beans" },
        { amount: 145, unit: "g", item: "fresh pesto" },
        { amount: 400, unit: "g", item: "cherry tomatoes on the vine" },
      ],
    },
  },
};

export const recipetineats_mediterranean: Fixture = {
  id: "recipetineats-mediterranean",
  input: {
    kind: "url",
    url: "https://www.recipetineats.com/mediterranean-baked-chicken-dinner/",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>Mediterranean Baked Chicken Dinner</h1>\n<script type=\"application/ld+json\">\n{\n \"@type\": \"Recipe\",\n \"name\": \"Mediterranean Chicken Dinner\",\n \"author\": {\n  \"@type\": \"Person\",\n  \"name\": \"Nagi | RecipeTin Eats\"\n },\n \"description\": \"Recipe video above. Infused with classic Mediterranean flavours of garlic, lemon, oregano and paprika, this is a terrific quick dinner idea. The sauce is the star of this and marinating is optional! I made this with drumsticks but you can make this with bone-in chicken thigh fillets too.\",\n \"datePublished\": \"2020-03-02T11:20:52+00:00\",\n \"image\": [\n  \"https://www.recipetineats.com/tachyon/2015/11/Lemon-Garlic-Chicken-Potato-Bake_7-copy.jpg\",\n  \"https://www.recipetineats.com/tachyon/2015/11/Lemon-Garlic-Chicken-Potato-Bake_7-copy.jpg?resize=500%2C500\",\n  \"https://www.recipetineats.com/tachyon/2015/11/Lemon-Garlic-Chicken-Potato-Bake_7-copy.jpg?resize=500%2C375\",\n  \"https://www.recipetineats.com/tachyon/2015/11/Lemon-Garlic-Chicken-Potato-Bake_7-copy.jpg?resize=480%2C270\"\n ],\n \"recipeYield\": [\n  \"4\",\n  \"4 - 5 people\"\n ],\n \"prepTime\": \"PT10M\",\n \"cookTime\": \"PT55M\",\n \"totalTime\": \"PT55M\",\n \"recipeIngredient\": [\n  \"1kg / 2lb  bone in, skin on chicken thighs and drumsticks ((Note 1))\",\n  \"1/2 cup (125 ml)  lemon juice\",\n  \"6 cloves garlic (, minced)\",\n  \"2 tsp Dijon mustard ((Optional - Note 2))\",\n  \"2 tbsp honey or 1 tbsp sugar ((or maple or other sweetener))\",\n  \"1 tbsp dried oregano\",\n  \"1.5 tsp paprika\",\n  \"1 tbsp olive oil\",\n  \"1/2 tsp EACH salt and pepper\",\n  \"5  smallish potatoes (7.5cm/3&quot; wide) (, quartered (Note 3))\",\n  \"2  red onions (, quartered)\",\n  \"1 cup (250ml)  chicken broth/stock (, low sodium)\",\n  \"250g/8oz  cherry tomatoes ((whole))\",\n  \"1/2 tsp EACH salt and pepper\",\n  \"1 tbsp Olive oil (or oil spray)\",\n  \"Fresh oregano (, for garnish (optional))\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Mix Marinade ingredients in a bowl, then add chicken and toss to coat. If time permits, marinate for 24 hours, otherwise proceed to next step.\",\n   \"name\": \"Mix Marinade ingredients in a bowl, then add chicken and toss to coat. If time permits, marinate for 24 hours, otherwise proceed to next step.\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-0\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Preheat oven to 180C/350F.\",\n   \"name\": \"Preheat oven to 180C/350F.\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-1\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Place potatoes and onion in baking pan, top with chicken. Pour over the chicken stock then marinade from the bowl.\",\n   \"name\": \"Place potatoes and onion in baking pan, top with chicken. Pour over the chicken stock then marinade from the bowl.\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-2\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Bake for 20 minutes, then remove from oven.\",\n   \"name\": \"Bake for 20 minutes, then remove from oven.\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-3\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Scatter over cherry tomatoes, drizzle everything with 1 tbsp olive oil, sprinkle with salt and pepper. Bake for a further 30 - 35 minutes until chicken is golden and potatoes are cooked.\",\n   \"name\": \"Scatter over cherry tomatoes, drizzle everything with 1 tbsp olive oil, sprinkle with salt and pepper. Bake for a further 30 - 35 minutes until chicken is golden and potatoes are cooked.\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-4\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Remove from oven, garnish with fresh oregano if using and serve!\",\n   \"name\": \"Remove from oven, garnish with fresh oregano if using and serve!\",\n   \"url\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#wprm-recipe-24918-step-0-5\"\n  }\n ],\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"ratingValue\": \"4.82\",\n  \"ratingCount\": \"165\",\n  \"reviewCount\": \"16\"\n },\n \"review\": [\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I just came to scroll down and see Dozer on the 3 seater couch all to himself. Lovely memories of our Recipetin Mascot.\\r\\nA wintery day in Brisbane and ready to put this in the oven. Absolute classic and I will make some garlic bread for dipping xxx\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Preeya Rook\"\n   },\n   \"datePublished\": \"2026-08-06\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I made this a couple of weeks ago and am planning on making it again this weekend for company.  It was absolutely delicious.\\r\\n\\r\\nI went a little heavier on the garlic and added some sumac to the potatoes/veggies just to double up a little on the citrus notes.\\r\\nI cooked it in my big 14\\\" cast iron skillet for about 30 minutes with a lid on and then another 25 or 30 with the lid off after adding the cherry tomatoes.\\r\\nVery, very good and great for my low sodium diet.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Collin\"\n   },\n   \"datePublished\": \"2026-07-25\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I too am so much more confident, and way more adventurous, in the kitchen since I discovered Nagi and Recipetineats.com a few years ago. I'm so grateful for her wonderful generosity in sharing her recipes, cooking skills, tips and tricks with us all. I purchased Dinner and Tonight as a way to give back, but I mainly still use the website. I love the scaling functionality as I am usually feeding a crowd.\\r\\nI vote Nagi for Australian of the year! Lol\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Peta\"\n   },\n   \"datePublished\": \"2026-07-13\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"4\"\n   },\n   \"reviewBody\": \"Although I enjoyed this easy to cook meal I found it a bit watery. Like others, I par boiled the potatoes but I think I’d put less liquid in next time as the marinade was tasty and the chicken would produce enough liquid I’d think. If I cooked it again, I’d add black olives. You’re still my favourite recipe creator\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Leonie Beckett\"\n   },\n   \"datePublished\": \"2026-07-11\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"3\"\n   },\n   \"reviewBody\": \"Love the flavours and concept but I followed the recipe very closely and needed a lot longer in the oven, or a slightly higher cook temp. The chicken and onions were not cooked enough and the potatoes came out very firm, even though they were cut nice and small. Also the potatoes really must be pre boiled. They don’t soften up due to all the acid in the liquid. I would also add a bit less liquid.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Matty\"\n   },\n   \"datePublished\": \"2026-03-31\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I found the same, great flavour but wanted a thicker sauce. I removed chicken and veggies from the pan and poured the liquid into a saucepan and boiled until desired consistency. It coats the chicken and veggies perfectly.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Peggy\"\n   },\n   \"datePublished\": \"2026-03-25\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I made this for my family for Shabbat dinner. It came out so good. I only did potatoes and red onion but it was perfect. The chicken was juicy but still had a crispy outside. I did splash a little lemon juice over everything and cooked uncovered for 10 mins before serving. Thank you!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Titra\"\n   },\n   \"datePublished\": \"2026-03-25\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I made this recipe last night.\\r\\nMy husband said it was the best chicken he’s ever had!!( he cooks too)He doesn’t give compliments.\\r\\nI did add olives, carrots and champignon mushrooms.\\r\\nI would give this recipe 10/10\\r\\nThe flavours are delectable\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Julia\"\n   },\n   \"datePublished\": \"2026-03-15\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Easy to do. Full of flavkur\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Sheila Paddison\"\n   },\n   \"datePublished\": \"2026-01-25\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Cooked this for lunch again today. I added carrots and tiny tomberry tomatoes this time. Marinating chicken drumsticks overnight certainly adds more depth of flavour. I've made this several times now, and each time it's a hit. It's an absolutely delicious and versatile dish.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kim\"\n   },\n   \"datePublished\": \"2025-12-28\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Thanks Nagi for another midweek lifesaver — these throw-everything-in-a-tray recipes are always a win in my house. I love how the potatoes soak up all that lemon-garlic goodness, especially when they get a little crisp around the edges.\\r\\n\\r\\nI’ll sometimes tuck in a handful of olives or swap in sweet potato if that’s what I’ve got around — still turns out perfect. Definitely bookmarking this one for nights when I want something low effort but full payoff.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Solis Paris\"\n   },\n   \"datePublished\": \"2025-12-08\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Such an easy recipe and tasted beautiful!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"YUMIKO TSUJI\"\n   },\n   \"datePublished\": \"2025-10-26\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Made this twice now, So good and so simple! Nagi do you think I could do this with fish?\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"S ali\"\n   },\n   \"datePublished\": \"2025-10-19\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Delicious. Added carrots, pumpkin pieces and olives as that’s what I had as well as the onions, potatoes etc.\\r\\nA hit with everyone and it’s been asked to be repeated. Thanks Nagi!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Wayne\"\n   },\n   \"datePublished\": \"2025-10-14\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This is absolutely delicious! Thanks Nagi for the great recipe!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Samuel Lin\"\n   },\n   \"datePublished\": \"2025-09-13\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Just made this today - what a winner. I added a quartered beetroot and a quartered round courgette from the garden. It made 5 good sized portions and the marinade gave it such a good flavour. Thank you x.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Janet\"\n   },\n   \"datePublished\": \"2025-09-12\"\n  }\n ],\n \"recipeCategory\": [\n  \"Dinner\"\n ],\n \"recipeCuisine\": [\n  \"Mediterranean\",\n  \"Western\"\n ],\n \"keywords\": \"chicken and potatoes, Chicken dinner, chicken tray bake\",\n \"nutrition\": {\n  \"@type\": \"NutritionInformation\",\n  \"servingSize\": \"503 g\",\n  \"calories\": \"90 kcal\",\n  \"carbohydrateContent\": \"50.6 g\",\n  \"proteinContent\": \"31.5 g\",\n  \"fatContent\": \"10 g\",\n  \"saturatedFatContent\": \"2.3 g\",\n  \"cholesterolContent\": \"81 mg\",\n  \"sodiumContent\": \"607 mg\",\n  \"fiberContent\": \"7.5 g\",\n  \"sugarContent\": \"14.4 g\"\n },\n \"@id\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#recipe\",\n \"isPartOf\": {\n  \"@id\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/#article\"\n },\n \"mainEntityOfPage\": \"https://www.recipetineats.com/mediterranean-baked-chicken-dinner/\"\n}\n</script>\n<ul class=\"ingredients\">\n  <li class=\"ingredient\">1kg / 2lb bone in, skin on chicken thighs and drumsticks (Note 1)</li>\n  <li class=\"ingredient\">1/2 cup (125 ml) lemon juice</li>\n  <li class=\"ingredient\">6 cloves garlic , minced</li>\n  <li class=\"ingredient\">2 tsp Dijon mustard (Optional &ndash; Note 2)</li>\n  <li class=\"ingredient\">2 tbsp honey or 1 tbsp sugar (or maple or other sweetener)</li>\n  <li class=\"ingredient\">1 tbsp dried oregano</li>\n  <li class=\"ingredient\">1.5 tsp paprika</li>\n  <li class=\"ingredient\">1 tbsp olive oil</li>\n  <li class=\"ingredient\">1/2 tsp EACH salt and pepper</li>\n  <li class=\"ingredient\">5 smallish potatoes (7.5cm/3\" wide) , quartered (Note 3)</li>\n  <li class=\"ingredient\">2 red onions , quartered</li>\n  <li class=\"ingredient\">1 cup (250ml) chicken broth/stock , low sodium</li>\n  <li class=\"ingredient\">250g/8oz cherry tomatoes (whole)</li>\n  <li class=\"ingredient\">1/2 tsp EACH salt and pepper</li>\n  <li class=\"ingredient\">1 tbsp Olive oil (or oil spray)</li>\n  <li class=\"ingredient\">Fresh oregano , for garnish (optional)</li>\n</ul>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Mediterranean Chicken Dinner",
      servings: 4,
      totalMinutes: 55,
      ingredients: [
        { amount: 1, unit: "kg", item: "bone in, skin on chicken thighs and drumsticks" },
        { amount: 0.5, unit: "cup", item: "lemon juice" },
        { amount: 6, unit: "clove", item: "garlic" },
        { amount: 2, unit: "tsp", item: "Dijon mustard" },
        { amount: 2, unit: "tbsp", item: "honey" },
        { amount: 1, unit: "tbsp", item: "dried oregano" },
        { amount: 1.5, unit: "tsp", item: "paprika" },
        { amount: 1, unit: "tbsp", item: "olive oil" },
        { amount: 0.5, unit: "tsp", item: "salt and pepper" },
        { amount: 5, unit: null, item: "smallish potatoes" },
        { amount: 2, unit: null, item: "red onions" },
        { amount: 1, unit: "cup", item: "chicken broth/stock" },
        { amount: 250, unit: "g", item: "cherry tomatoes" },
        { amount: 0.5, unit: "tsp", item: "salt and pepper" },
        { amount: 1, unit: "tbsp", item: "olive oil" },
        { amount: null, unit: null, item: "fresh oregano" },
      ],
    },
  },
};

export const recipetineats_chicken_breast: Fixture = {
  id: "recipetineats-chicken-breast",
  input: {
    kind: "url",
    url: "https://www.recipetineats.com/chicken-breast-recipe/",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>My go-to Chicken Breast recipe</h1>\n<script type=\"application/ld+json\">\n{\n \"@type\": \"Recipe\",\n \"name\": \"My go-to Chicken Breast recipe\",\n \"author\": {\n  \"@id\": \"https://www.recipetineats.com/#/schema/person/1684e6a75e9f91ae2e33ca2de95b47e2\"\n },\n \"description\": \"Recipe video above. Ready in 12 minutes, this is my current go-to chicken breast recipe. AKA Pan-Seared Country Seasoned Chicken Breast with Butter Sauce, it&#39;s fast, simple, not-boring and you can make it anytime with pantry staples!Simple country-inspired seasoning tossed with the tiniest amount of flour so the chicken gets a lovely crust on it, served with a butter sauce made in the same pan so it gets flavour from the residual seasoning.Mix and match magic: Skip the sauce and just serve the seasoned chicken, or skip the spices and let the butter sauce shine with a simple salt-and-pepper seared chicken.\",\n \"datePublished\": \"2025-07-30T16:00:00+00:00\",\n \"image\": [\n  \"https://www.recipetineats.com/tachyon/2025/07/Anytime-Chicken-Breast-in-white-wine-sauce_5.jpg\",\n  \"https://www.recipetineats.com/tachyon/2025/07/Anytime-Chicken-Breast-in-white-wine-sauce_5.jpg?resize=500%2C500\",\n  \"https://www.recipetineats.com/tachyon/2025/07/Anytime-Chicken-Breast-in-white-wine-sauce_5.jpg?resize=500%2C375\",\n  \"https://www.recipetineats.com/tachyon/2025/07/Anytime-Chicken-Breast-in-white-wine-sauce_5.jpg?resize=480%2C270\"\n ],\n \"recipeYield\": [\n  \"4\"\n ],\n \"prepTime\": \"PT5M\",\n \"cookTime\": \"PT7M\",\n \"recipeIngredient\": [\n  \"2  large chicken breasts ((250 - 300g/8 - 10 oz each), each cut in half horizontally to form 4 steaks, no need to pound (Note 1))\",\n  \"20g/ 1 1/2 tbsp  unsalted butter (or 1 1/2 tbsp olive oil)\",\n  \"1 tsp paprika (, regular/sweet (or smoky))\",\n  \"1/2 tsp onion powder ((or more garlic))\",\n  \"1/2 tsp garlic powder ((or more onion))\",\n  \"1/4 tsp cumin ((sub coriander, thyme leaves crushed between fingers, or omit))\",\n  \"3/4 tsp cooking salt / kosher salt ((halve for table salt, +50% for flakes))\",\n  \"1/8 tsp black pepper\",\n  \"1 1/2 tbsp flour (, plain/all-purpose, GF (Note 2))\",\n  \"1/3 cup dry white wine ( or chicken stock (low sodium), sub water (Note 3))\",\n  \"30g/ 2 tbsp  unsalted butter\",\n  \"1 tbsp roughly chopped parsley (, optional but recommended)\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToSection\",\n   \"name\": \"ABBREVIATED\",\n   \"itemListElement\": [\n    {\n     \"@type\": \"HowToStep\",\n     \"text\": \"Dust chicken with Seasoning, pan fry in the butter, remove. Deglaze with wine, melt in butter, serve sauce on chicken.\",\n     \"name\": \"Dust chicken with Seasoning, pan fry in the butter, remove. Deglaze with wine, melt in butter, serve sauce on chicken.\",\n     \"url\": \"https://www.recipetineats.com/chicken-breast-recipe/#wprm-recipe-181807-step-0-0\"\n    }\n   ]\n  },\n  {\n   \"@type\": \"HowToSection\",\n   \"name\": \"FULL RECIPE\",\n   \"itemListElement\": [\n    {\n     \"@type\": \"HowToStep\",\n     \"text\": \"Season - Mix the Seasoning ingredients in a bowl. Sprinkle on each side of the chicken, spreading with fingertips to coat evenly, then shake off excess.\",\n     \"name\": \"Season - Mix the Seasoning ingredients in a bowl. Sprinkle on each side of the chicken, spreading with fingertips to coat evenly, then shake off excess.\",\n     \"url\": \"https://www.recipetineats.com/chicken-breast-recipe/#wprm-recipe-181807-step-1-0\"\n    },\n    {\n     \"@type\": \"HowToStep\",\n     \"text\": \"Sear - Melt the butter in a large non-stick pan over high heat. Cook chicken for 2 1/2 minutes on each side until deep golden, or until the internal temperature reaches 67C/153F. Remove onto a plate.\",\n     \"name\": \"Sear - Melt the butter in a large non-stick pan over high heat. Cook chicken for 2 1/2 minutes on each side until deep golden, or until the internal temperature reaches 67C/153F. Remove onto a plate.\",\n     \"url\": \"https://www.recipetineats.com/chicken-breast-recipe/#wprm-recipe-181807-step-1-1\"\n    },\n    {\n     \"@type\": \"HowToStep\",\n     \"text\": \"Pan sauce - Lower then heat to medium high. Add the wine and simmer rapidly for 1 - 1 1/2 minutes, scraping the pan with a rubber spatula to loosen the golden bits into the sauce, until it&#39;s reduced by half. Add the butter and let it melt, mixing well to combine. (Note 4 on sauce amount)\",\n     \"name\": \"Pan sauce - Lower then heat to medium high. Add the wine and simmer rapidly for 1 - 1 1/2 minutes, scraping the pan with a rubber spatula to loosen the golden bits into the sauce, until it&#39;s reduced by half. Add the butter and let it melt, mixing well to combine. (Note 4 on sauce amount)\",\n     \"url\": \"https://www.recipetineats.com/chicken-breast-recipe/#wprm-recipe-181807-step-1-2\"\n    },\n    {\n     \"@type\": \"HowToStep\",\n     \"text\": \"Serve - Serve chicken with sauce and sprinkled with parsley. Enjoy!\",\n     \"name\": \"Serve - Serve chicken with sauce and sprinkled with parsley. Enjoy!\",\n     \"url\": \"https://www.recipetineats.com/chicken-breast-recipe/#wprm-recipe-181807-step-1-3\"\n    }\n   ]\n  }\n ],\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"ratingValue\": \"4.99\",\n  \"ratingCount\": \"76\",\n  \"reviewCount\": \"18\"\n },\n \"review\": [\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"So dam good! Full of flavour &amp; chicken was succulent. Easy, tasty dinner. Thank you, miss❤️ you Dozer\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Belinda\"\n   },\n   \"datePublished\": \"2026-08-08\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Love this easy, flavourful spice blend and use it with both chicken &amp; pork tenderloin chops. If time permits, pat dry, use rub and dry brine on an open rack in the fridge a few hours before the air fryer. Brilliantly crispy chops or chicken breasts - no sauce! If made in a pan, the butter sauce is lovely. Either or, we enjoy this so much with roasted potatoes and steamed veggies.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Dee\"\n   },\n   \"datePublished\": \"2026-06-18\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Super flavorful and incredibly quick to make!! Definitely going into the regular rotation. Thank you!!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"annika\"\n   },\n   \"datePublished\": \"2026-05-14\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Simple, tasty and although I did cut my chicken breasts into 2/3 (they were very thick) they didn't dry out and everyone loved them, Thanks for the \\r\\nrecipe\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"ESTHER\"\n   },\n   \"datePublished\": \"2026-04-21\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Amazing! We have a picky 15-yr-old boy and he took one bite and said \\\"yum\\\" and demolished it. Hooray! Thank you so much! We served with mashed potatoes (the 15-yr-old enlisted to do the mashing) and then after the deglazing, we refreshed some day-old steamed broccoli in the chicken pan. Usually day-old broccoli is the devil, but this was *mwah* perfect. Thank you, thank you for this recipe!!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Annie\"\n   },\n   \"datePublished\": \"2026-04-18\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This recipe was very good. I give it five stars. It's very easy and quick. I made it using smoked paprika and in the butter sauce I used chicken stock. I will definitely make this again. So flavorful!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Nancy Hamm\"\n   },\n   \"datePublished\": \"2026-04-11\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I make this every week since I tried it, sometimes twice a week ok often twice. Its quick to make and best of all delicious! Everyone loves it! thank you love the way you cook!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"eileen pappadopoulos\"\n   },\n   \"datePublished\": \"2026-04-04\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I just made this and I’m eating it while I comment. So good! I used tapioca flour and it has the best gluten-free crust. Thank you!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Veronica\"\n   },\n   \"datePublished\": \"2026-03-26\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I absolutely love this recipe. It is so quick and easy to do. The end result is absolutely fantastic. Perfect as a quick recipe but lovely meal at the end of a long day. \\r\\n\\r\\nThank you so much\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Leanne Borg\"\n   },\n   \"datePublished\": \"2026-03-24\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"My new favorite! So easy. We marinated overnight \\r\\n\\r\\nRecipetineats always has the best\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Patrick\"\n   },\n   \"datePublished\": \"2026-03-23\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I gave this a shot and absolutely will be putting this on my list for weekly recipes. It’s so simple and turned out amazing. The best part is, the white wine you use to make the sauce pairs perfectly with the meal. Fantastic! Thank you-\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"David Hayes\"\n   },\n   \"datePublished\": \"2026-03-21\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Awesome chicken recipe! Very tender and not dry. I'll be making this on repeat. Also love your vanilla cake recipe.\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"CC\"\n   },\n   \"datePublished\": \"2026-03-21\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I doubled the recipe for. my family of five.  This is the second time I made it and it was a hit again!  This time I used a red wine because I didn't have the white wine and it was delicious as well.  Served it with small red potatoes, slightly mashed with salt and butter, and parsley mixed in and a salad.  So yummy!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Rita\"\n   },\n   \"datePublished\": \"2026-03-17\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"I’ve been hunting for quick meals to make to help out my daughter in law.  I gave it a try tonight-super quick to make, had all the ingredients already in my pantry. Paired it with mashed potatoes and roasted broccoli. Really delish!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Lin N.\"\n   },\n   \"datePublished\": \"2026-03-17\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"test\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"test\"\n   },\n   \"datePublished\": \"2026-03-13\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Thank you for sharing this recipe! I made it this evening. I will be making it again\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Paul A Orsi\"\n   },\n   \"datePublished\": \"2026-03-06\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"This recipe was chef’s kiss!\\r\\n\\r\\nAnd so easy and quick\\r\\n\\r\\nI had run out of paprika and used some cayenne pepper instead. Was delicious\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Louisa\"\n   },\n   \"datePublished\": \"2026-02-23\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"reviewRating\": {\n    \"@type\": \"Rating\",\n    \"ratingValue\": \"5\"\n   },\n   \"reviewBody\": \"Quick, easy, and husband approved. Thanks for a great new recipe!\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Carol\"\n   },\n   \"datePublished\": \"2026-02-20\"\n  }\n ],\n \"recipeCategory\": [\n  \"Mains\"\n ],\n \"recipeCuisine\": [\n  \"Western\"\n ],\n \"keywords\": \"chicken breast recipe, chicken in white wine butter sauce, pan seared chicken breast\",\n \"@id\": \"https://www.recipetineats.com/chicken-breast-recipe/#recipe\",\n \"isPartOf\": {\n  \"@id\": \"https://www.recipetineats.com/chicken-breast-recipe/#article\"\n },\n \"mainEntityOfPage\": \"https://www.recipetineats.com/chicken-breast-recipe/\"\n}\n</script>\n<ul class=\"ingredients\">\n  <li class=\"ingredient\">2 large chicken breasts (250 &ndash; 300g/8 &ndash; 10 oz each), each cut in half horizontally to form 4 steaks, no need to pound (Note 1)</li>\n  <li class=\"ingredient\">20g/ 1 1/2 tbsp unsalted butter or 1 1/2 tbsp olive oil</li>\n  <li class=\"ingredient\">1 tsp paprika , regular/sweet (or smoky)</li>\n  <li class=\"ingredient\">1/2 tsp onion powder (or more garlic)</li>\n  <li class=\"ingredient\">1/2 tsp garlic powder (or more onion)</li>\n  <li class=\"ingredient\">1/4 tsp cumin (sub coriander, thyme leaves crushed between fingers, or omit)</li>\n  <li class=\"ingredient\">3/4 tsp cooking salt / kosher salt (halve for table salt, +50% for flakes)</li>\n  <li class=\"ingredient\">1/8 tsp black pepper</li>\n  <li class=\"ingredient\">1 1/2 tbsp flour , plain/all-purpose, GF (Note 2)</li>\n  <li class=\"ingredient\">1/3 cup dry white wine or chicken stock (low sodium), sub water (Note 3)</li>\n  <li class=\"ingredient\">30g/ 2 tbsp unsalted butter</li>\n  <li class=\"ingredient\">1 tbsp roughly chopped parsley , optional but recommended</li>\n</ul>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "My go-to Chicken Breast recipe",
      servings: 4,
      totalMinutes: 12,
      ingredients: [
        { amount: 2, unit: null, item: "chicken breasts" },
        { amount: 20, unit: "g", item: "unsalted butter" },
        { amount: 1, unit: "tsp", item: "paprika" },
        { amount: 0.5, unit: "tsp", item: "onion powder" },
        { amount: 0.5, unit: "tsp", item: "garlic powder" },
        { amount: 0.25, unit: "tsp", item: "cumin" },
        { amount: 0.75, unit: "tsp", item: "cooking salt / kosher salt" },
        { amount: 0.125, unit: "tsp", item: "black pepper" },
        { amount: 1.5, unit: "tbsp", item: "flour" },
        { amount: 0.333, unit: "cup", item: "dry white wine" },
        { amount: 30, unit: "g", item: "unsalted butter" },
        { amount: 1, unit: "tbsp", item: "roughly chopped parsley" },
      ],
    },
  },
};

export const nytimes_tomato_jam: Fixture = {
  id: "nytimes-tomato-jam",
  input: {
    kind: "url",
    url: "https://cooking.nytimes.com/recipes/1017532-tomato-jam",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>Tomato Jam</h1>\n<script type=\"application/ld+json\">\n{\n \"@context\": \"https://schema.org\",\n \"@id\": \"urn:nyt:ScoopRecipe:a81be512d95a567daa7d8dfabba7e712\",\n \"@type\": \"Recipe\",\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"ratingCount\": 1711,\n  \"ratingValue\": 5\n },\n \"author\": {\n  \"@id\": \"nyt://person/83cb79c0-6b11-5a3e-8c4d-fba1ec752388\",\n  \"@type\": \"Person\",\n  \"description\": \"Mark Bittman contributed hundreds of recipes to The New York Times and wrote the Minimalist&nbsp;column for the Dining section for 13 years, beginning in 1997. He was later a Times Opinion columnist and the lead food writer for The New York Times Magazine.\",\n  \"name\": \"Mark Bittman\",\n  \"sameAs\": [\n   \"https://www.nytimes.com/by/mark-bittman\",\n   \"https://x.com/bittman\"\n  ],\n  \"url\": \"https://cooking.nytimes.com/author/mark-bittman\"\n },\n \"cookingMethod\": \"Boil, Simmer\",\n \"copyrightHolder\": {\n  \"@id\": \"https://cooking.nytimes.com/#publisher\",\n  \"@type\": \"Organization\",\n  \"name\": \"NYT Cooking\"\n },\n \"copyrightYear\": 2015,\n \"dateModified\": \"2015-07-07T00:00:00Z\",\n \"datePublished\": \"2015-07-07T00:00:00Z\",\n \"description\": \"Good tomatoes and balance are crucial. You need sugar for the kind of gooey, sticky quality we associate with jam; otherwise, all you’re producing is a tomato sauce, no matter how different the flavor is from the classic. Once you add that sugar, however, you need acid, because even though tomatoes are plenty acidic, they can’t counter all that sugar. I tried lemon juice, vinegar and finally lime, deciding that I liked the last best.\",\n \"image\": [\n  {\n   \"@id\": \"nyt://image/c2ea9439-f708-57d9-aff6-4d09cb410d25#superJumbo\",\n   \"@type\": \"ImageObject\",\n   \"contentUrl\": \"https://static01.nyt.com/images/2015/07/07/dining/tomato-jam/tomato-jam-superJumbo.jpg\",\n   \"creditText\": \"Evan Sung for The New York Times\",\n   \"dateModified\": \"2015-07-07T23:30:34.000Z\",\n   \"datePublished\": \"2015-07-07T23:30:55.000Z\",\n   \"height\": \"1361\",\n   \"uploadDate\": \"2015-07-07T23:30:55.000Z\",\n   \"url\": \"https://static01.nyt.com/images/2015/07/07/dining/tomato-jam/tomato-jam-superJumbo.jpg\",\n   \"width\": \"2048\"\n  },\n  {\n   \"@id\": \"nyt://image/c2ea9439-f708-57d9-aff6-4d09cb410d25#facebookJumbo\",\n   \"@type\": \"ImageObject\",\n   \"contentUrl\": \"https://static01.nyt.com/images/2015/07/07/dining/tomato-jam/tomato-jam-facebookJumbo.jpg\",\n   \"creditText\": \"Evan Sung for The New York Times\",\n   \"dateModified\": \"2015-07-07T23:30:34.000Z\",\n   \"datePublished\": \"2015-07-07T23:30:55.000Z\",\n   \"height\": \"550\",\n   \"uploadDate\": \"2015-07-07T23:30:55.000Z\",\n   \"url\": \"https://static01.nyt.com/images/2015/07/07/dining/tomato-jam/tomato-jam-facebookJumbo.jpg\",\n   \"width\": \"1050\"\n  }\n ],\n \"isAccessibleForFree\": false,\n \"keywords\": \"Project, Tomato\",\n \"mainEntityOfPage\": {\n  \"@id\": \"//cooking.nytimes.com/recipes/1017532-tomato-jam\",\n  \"@type\": \"WebPage\",\n  \"name\": \"Tomato Jam\"\n },\n \"name\": \"Tomato Jam\",\n \"nutrition\": {\n  \"@type\": \"NutritionInformation\",\n  \"calories\": \"230\",\n  \"carbohydrateContent\": \"58 grams\",\n  \"fatContent\": \"0.5 grams\",\n  \"fiberContent\": \"2.3 grams\",\n  \"proteinContent\": \"1.7 grams\",\n  \"saturatedFatContent\": \"0.1 grams\",\n  \"sodiumContent\": \"535.3 milligrams\",\n  \"sugarContent\": \"54.6 grams\",\n  \"unsaturatedFatContent\": \"0.2 grams\"\n },\n \"publisher\": {\n  \"@id\": \"https://cooking.nytimes.com/#publisher\",\n  \"@type\": \"Organization\",\n  \"name\": \"NYT Cooking\"\n },\n \"recipeCategory\": \"Jams, Jellies and Preserves\",\n \"recipeIngredient\": [\n  \"1 ½ pounds good ripe tomatoes (Roma are best), cored and coarsely chopped\",\n  \"1 cup sugar\",\n  \"2 tablespoons freshly squeezed lime juice\",\n  \"1 tablespoon fresh grated or minced ginger\",\n  \"1 teaspoon ground cumin\",\n  \"¼ teaspoon ground cinnamon\",\n  \"⅛ teaspoon ground cloves\",\n  \"1 teaspoon salt\",\n  \"1 jalapeño or other peppers, stemmed, seeded and minced, or red pepper flakes or cayenne to taste\"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Combine all ingredients in a heavy medium saucepan, Bring to a boil over medium heat, stirring often.\",\n   \"url\": \"https://cooking.nytimes.com/recipes/1017532-tomato-jam#recipe-step-1\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Reduce heat and simmer, stirring occasionally, until mixture has consistency of thick jam, about 1 hour 15 minutes. Taste and adjust seasoning, then cool and refrigerate until ready to use; this will keep at least a week.\",\n   \"url\": \"https://cooking.nytimes.com/recipes/1017532-tomato-jam#recipe-step-2\"\n  }\n ],\n \"recipeYield\": \"1 pint\",\n \"review\": [\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Beth in Boston\"\n   },\n   \"datePublished\": \"2026-08-05T01:42:51Z\",\n   \"reviewBody\": \"This tomato jam is ketchup‘s cousin that went to Europe for a semester abroad and returned forever changed— sophisticated, stylish, newfound depth.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"KnW\"\n   },\n   \"datePublished\": \"2026-07-30T18:19:13Z\",\n   \"reviewBody\": \"Made a version of this and it’s DELICIOUS. I can’t imagine it with all the sugar. This just tastes like tomatoes and it’s wonderful. We’ve eaten almost half of it in less than 2 days. I plan to make more and properly can it so I can save it for when tomatoes are no longer plentiful. \\n2 lb Sungold\\nHeaping 1/4 cup sugar\\n1 tsp salt\\nWhite pepper\\n3/4 tsp chili flake\\nZest and juice of one lemon\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Lizzielou\"\n   },\n   \"datePublished\": \"2026-07-07T14:15:05Z\",\n   \"reviewBody\": \"I love cumin, but this is far too cumin-forward for me - it's the dominant flavor. I'd make this again, but reduce the cumin by at least half.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Chris\"\n   },\n   \"datePublished\": \"2026-08-11T00:13:44Z\",\n   \"reviewBody\": \"@kate no need. I don’t even bother to core them :)\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"kate\"\n   },\n   \"datePublished\": \"2026-04-28T19:02:37Z\",\n   \"reviewBody\": \"Do I need to peel the tomatoes?\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"TerryB\"\n   },\n   \"datePublished\": \"2026-01-17T23:20:05Z\",\n   \"reviewBody\": \"I make this with smoked cherry tomatoes and it’s chef’s kiss, especially spread over a block of cream cheese with crackers.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Mindy\"\n   },\n   \"datePublished\": \"2025-11-09T17:05:45Z\",\n   \"reviewBody\": \"@Evie\\nJust core it. No need to remove the seeds\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Evie\"\n   },\n   \"datePublished\": \"2025-11-03T01:52:06Z\",\n   \"reviewBody\": \"When you core a tomato, do you remove the seeds, or just the tough stem end?\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Nikki\"\n   },\n   \"datePublished\": \"2025-10-13T06:49:04Z\",\n   \"reviewBody\": \"I'm shocked by these ratings, overall I think this is a good base recipe, minus all the sugar. I have a sweet tooth and LOVE sugar, while I read the comments, I did take the advice of a few who mentioned cutting the sugar down to at least 1/2 cup, but in honestly I should have cut this to 1/4 cup, I let it simmer down much longer, I adding chili flakes, chipotle powder to give it a slight kick, in an attempt to help cut the sweetness, it helped a little.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Tanya\"\n   },\n   \"datePublished\": \"2025-10-10T14:29:51Z\",\n   \"reviewBody\": \"As per other comments, I would not use any sugar, add Pomona pectin and maybe use fruit like ground cherries or apple or maybe xylotol or stevia if a sweetener was needed.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Ellen in NM\"\n   },\n   \"datePublished\": \"2025-09-30T23:14:15Z\",\n   \"reviewBody\": \"I have an abundance of tomatoes this year and have made this recipe four times now (with about 25 pounds of tomatoes). I made a bunch of changes, but the one I wanted to to share is how to reduce the cooking time.\\n\\nYou can pre-cook the tomatoes in an InstantPot, let it cool and then drain off a lot of the liquid (instead of cooking it down). My 6 quart InstantPot held about 9 pounds of chopped paste tomatoes. I cooked it on low pressure for 1 minute, did a quick release, and then drained the liquid. It still took several hours to cook down. With added onions and bell peppers, this made 6-1/2 pints of jam.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Emily Rose\"\n   },\n   \"datePublished\": \"2025-09-20T02:44:49Z\",\n   \"reviewBody\": \"I especially like this on peanut butter toast. I've made it twice, each time with cherry tomatoes and habanero from the garden.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Cooking with Cats\"\n   },\n   \"datePublished\": \"2025-09-15T13:42:13Z\",\n   \"reviewBody\": \"Canned about 5 jars using Mark's recipe and adding a few extra spices. Pectin enhanced sugar and sterilized jars were the key. Haven't tried it yet but a taste test before putting into jars was promising.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Audrey M\"\n   },\n   \"datePublished\": \"2025-09-09T03:54:47Z\",\n   \"reviewBody\": \"Amazing recipe. Great way to use up a bunch of extra tomatoes from the garden. I've made this recipe twice - the second time I cooked it for about ~15 minutes longer than instructed to get my desired consistency. I used a mix of different varieties of tomatoes (whatever I had on hand) and it turned out great. We love it on eggs and toast!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Sophia Louise\"\n   },\n   \"datePublished\": \"2025-09-08T07:41:28Z\",\n   \"reviewBody\": \"Instead of jalapeños I used 1/2 tsp of chili flakes and I felt that gave it the perfect amount of spice\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Jay\"\n   },\n   \"datePublished\": \"2025-08-31T13:12:46Z\",\n   \"reviewBody\": \"I halved the sugar and it's still far too sweet for my taste! Next time I make this, I'll try 1/4 cup. After all, you can add sugar, but you can't take it away.\\n\\nUnless you love incredibly sweet things, heed the warnings to reduce the sugar\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Chad H\"\n   },\n   \"datePublished\": \"2025-08-29T02:19:52Z\",\n   \"reviewBody\": \"This is an absolute winner!  A great addition to a cheese board.  I make it every summer\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Len\"\n   },\n   \"datePublished\": \"2015-08-26T20:55:07Z\",\n   \"reviewBody\": \"Folks,<br/><br/>You may want to check out a pectin called Pomona's Universal Pectin.  It differs from \\\"normal\\\" pectins in that it does not need any sugar to make the jam.  The pectin is from citrus skins.  It uses Calcium (provided as the catalyst).  Find it on amazon.  We are reducing sugar intake (typically 50 to 85% in jams). This makes a very good jam.  For a light sweetness, we use maple syrup or honey.  You can also use artificial sweeteners.  Jams actually taste fruity.  Highly recommend.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Melinda\"\n   },\n   \"datePublished\": \"2016-06-03T14:12:38Z\",\n   \"reviewBody\": \"When I am too lazy to put much effort into dinner, I toast some bread, spread this jam on top, then scramble an egg with hot pepper flakes and parmesan cheese and put that on top also.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Mary Ann\"\n   },\n   \"datePublished\": \"2015-09-12T16:26:07Z\",\n   \"reviewBody\": \"Nice flavor but too much sugar.  I would start with 1/4 cup and add up to 1/2 cup as needed.  I also put 1 chopped yellow pepper and 1/2 chopped red onion into it.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Natalie\"\n   },\n   \"datePublished\": \"2015-09-05T13:48:08Z\",\n   \"reviewBody\": \"Halve the sugar, half again the cooking time.<br/>Cook until a path scraped across the bottom doesn't fill in.<br/>Made just under two half-pints, jars preheated at 325° for 15 minutes to seal.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Julie\"\n   },\n   \"datePublished\": \"2015-08-19T14:21:08Z\",\n   \"reviewBody\": \"I have made a large batch or two of this every year for the last 4 years, reduce the sugar, increase the lime juice and ginger, use jalapeño, serrano or habanero peppers and cook it down in an electric skillet on low to reduce the need to stir and the risk of scorching. Taste.  I do a hot water bath as for other jams and give as gifts with friends asking when they will receive another jar of jam. Is very good in chicken/turkey sandwiches, pork sausage patties and biscuits and seasoning stir fry\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kathy\"\n   },\n   \"datePublished\": \"2015-09-30T01:01:06Z\",\n   \"reviewBody\": \"With crackers and sharp cheese!<br/>You can make this recipe and then freeze it in small amounts.  Thaws just great when someone comes over.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kate\"\n   },\n   \"datePublished\": \"2016-11-09T09:57:24Z\",\n   \"reviewBody\": \"Used 6 lbs of tomatoes, so quadrupled the recipe with two exceptions: 1) Only added 2 t of salt rather than 4 (and it was kosher, not table salt). 2) I used 2 c white sugar and 1 cup dark brown sugar for a total of 3 c of sugar, rather than 4 c (since other users remarked it was too sweet).<br/><br/>Simmered on low heat for a good 6 hours or so, until it had reduced by just over half. Absolutely scrumptious. Ended up with approx 5 c of jam (40 oz.)\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Kathy D\"\n   },\n   \"datePublished\": \"2015-08-18T17:00:08Z\",\n   \"reviewBody\": \"Check out the \\\"Food in Jars\\\" blog - she does not advise canning recipes that have not been specifically tested for canning; however, she also has a tomato jam recipe on the current blog, and in her archive/cookbook.  My gut says this one would be fine; but check first.<br/><a href=\\\"http://www.foodinjars.com\\\" title=\\\"www.foodinjars.com\\\" target=\\\"_blank\\\">www.foodinjars.com</a>\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"charlie\"\n   },\n   \"datePublished\": \"2017-08-26T18:15:24Z\",\n   \"reviewBody\": \"I've made this several times now and the stated directions are best. When I tried halving the sugar, the jam tasted too much like marinara. 75 minutes was just about right for cooking time if you cook at a medium temp. I guess the cooking time could be shorter if you have drier tomatoes or cook on high, but my tomatoes were straight from the garden and full of moisture. \"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Getty\"\n   },\n   \"datePublished\": \"2015-09-02T10:06:09Z\",\n   \"reviewBody\": \"Love a nice tomato jam for spreading on crackers with creamy goat cheese - fantastic appetizer. Also good with any roasted or barbecued meat. Try it on burgers instead of ketchup.<br/>Here's a recipe that's great for safe canning as well as links to a couple of other great tomato jams (of which this is one!). <a href=\\\"http://www.gettystewart.com/tomato-jam/\\\" title=\\\"http://www.gettystewart.com/tomato-jam/\\\" target=\\\"_blank\\\">http://www.gettystewart.com/tomato-jam/</a>\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Joanne L\"\n   },\n   \"datePublished\": \"2016-08-23T15:01:00Z\",\n   \"reviewBody\": \"I hope you did not seal using a preheated oven.  Either put in fridge for up to 2 weeks or water bath can according to the alritude where you live. 10 mins in boiling water is the minimum!\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Reg\"\n   },\n   \"datePublished\": \"2015-08-24T11:41:09Z\",\n   \"reviewBody\": \"My guess is that the larger amount of sugar is needed to preserve.  Most fruit jams call for a sugar amount that is 3/4 of the fruit amount.  Perhaps this recipe would last more than a week.......\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Joni\"\n   },\n   \"datePublished\": \"2017-07-10T10:14:06Z\",\n   \"reviewBody\": \"Did I miss something?  Does this recipe need pectin?  I don't see it listed.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"Janice P.\"\n   },\n   \"datePublished\": \"2016-08-17T21:09:27Z\",\n   \"reviewBody\": \"This has been a stand=by recipe for years. I can it, processing for 20 minutes, 1/4 inch headspace. Love it.\"\n  },\n  {\n   \"@type\": \"Review\",\n   \"author\": {\n    \"@type\": \"Person\",\n    \"name\": \"KRM\"\n   },\n   \"datePublished\": \"2015-08-19T22:41:06Z\",\n   \"reviewBody\": \"I reduced the sugar to 1/2 cup upon reading the other notes and I am glad I did.\"\n  }\n ],\n \"totalTime\": \"PT1H30M\",\n \"url\": \"//cooking.nytimes.com/recipes/1017532-tomato-jam\"\n}\n</script>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Tomato Jam",
      servings: null,
      totalMinutes: 90,
      ingredients: [
        { amount: 1.5, unit: "lb", item: "good ripe tomatoes" },
        { amount: 1, unit: "cup", item: "sugar" },
        { amount: 2, unit: "tbsp", item: "freshly squeezed lime juice" },
        { amount: 1, unit: "tbsp", item: "fresh grated or minced ginger" },
        { amount: 1, unit: "tsp", item: "ground cumin" },
        { amount: 0.25, unit: "tsp", item: "ground cinnamon" },
        { amount: 0.125, unit: "tsp", item: "ground cloves" },
        { amount: 1, unit: "tsp", item: "salt" },
        { amount: 1, unit: null, item: "jalapeño or other peppers" },
      ],
    },
  },
};

export const americastestkitchen_mismatch: Fixture = {
  id: "americastestkitchen-mismatch",
  input: {
    kind: "url",
    url: "https://www.americastestkitchen.com/recipes/11322-crispy-skin-pan-seared-chicken-breasts",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>Sautéed Mushrooms with Red Wine and Rosemary</h1>\n<script type=\"application/ld+json\">\n{\n \"@context\": \"https://schema.org\",\n \"@type\": \"Recipe\",\n \"name\": \"Sautéed Mushrooms with Red Wine and Rosemary\",\n \"url\": \"https://www.americastestkitchen.com/recipes/11322-sauteed-mushrooms-with-red-wine-and-rosemary\",\n \"author\": [\n  {\n   \"@type\": \"Person\",\n   \"name\": \"Lan Lam\",\n   \"url\": \"https://www.americastestkitchen.com/authors/41\"\n  }\n ],\n \"totalTime\": \"PT35M\",\n \"datePublished\": \"2018-11-19T00:00:00.000Z\",\n \"dateModified\": \"2026-07-28T23:50:47.559Z\",\n \"description\": \"Want savory, meaty-textured, deeply browned mushrooms without a lot of work, time, or even oil? Start by adding water.\",\n \"image\": [\n  {\n   \"@type\": \"ImageObject\",\n   \"height\": 1200,\n   \"contentUrl\": \"https://res.cloudinary.com/hksqkdlah/image/upload/c_fill,dpr_2.0,f_auto,fl_lossy.progressive.strip_profile,g_faces:auto,q_auto:low/43118-sfs-sauteedportobellomushroomsredwinerosemary-33\",\n   \"creditText\": \"America's Test Kitchen\",\n   \"representativeOfPage\": true,\n   \"url\": \"https://res.cloudinary.com/hksqkdlah/image/upload/c_fill,dpr_2.0,f_auto,fl_lossy.progressive.strip_profile,g_faces:auto,q_auto:low/43118-sfs-sauteedportobellomushroomsredwinerosemary-33\",\n   \"width\": 1200\n  }\n ],\n \"recipeIngredient\": [\n  \"1 1/4 pounds mushrooms \",\n  \"1/4 cup water \",\n  \"1/2 teaspoon vegetable oil \",\n  \"1 tablespoon unsalted butter \",\n  \"1 shallot, minced\",\n  \"1 teaspoon minced fresh rosemary \",\n  \"1/4 teaspoon table salt \",\n  \"1/4 teaspoon pepper \",\n  \"1/4 cup red wine \",\n  \"1 tablespoon cider vinegar \",\n  \"1/2 cup chicken broth \"\n ],\n \"recipeInstructions\": [\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Cook mushrooms and water in 12-inch nonstick skillet over high heat, stirring occasionally, until skillet is almost dry and mushrooms begin to sizzle, 4 to 8 minutes. Reduce heat to medium-high. Add oil and toss until mushrooms are evenly coated. Continue to cook, stirring occasionally, until mushrooms are well browned, 4 to 8 minutes longer. Reduce heat to medium.\"\n  },\n  {\n   \"@type\": \"HowToStep\",\n   \"text\": \"Push mushrooms to sides of skillet. Add butter to center. When butter has melted, add shallot, rosemary, salt, and pepper to center and cook, stirring constantly, until aromatic, about 30 seconds. Add wine and vinegar and stir mixture into mushrooms. Cook, stirring occasionally, until liquid has evaporated, 2 to 3 minutes. Add broth and cook, stirring occasionally, until glaze is reduced by half, about 3 minutes. Season with salt and pepper to taste, and serve.\"\n  }\n ],\n \"nutrition\": {\n  \"@type\": \"NutritionInformation\",\n  \"calories\": \"97\",\n  \"carbohydrateContent\": \"9 g\",\n  \"cholesterolContent\": \"9 mg\",\n  \"fiberContent\": \"2 g\",\n  \"proteinContent\": \"6 g\",\n  \"sodiumContent\": \"199 mg\"\n },\n \"recipeYield\": [\n  4,\n  \"Serves 4\"\n ],\n \"commentCount\": 75,\n \"tool\": [],\n \"isAccessibleForFree\": false,\n \"hasPart\": {\n  \"@type\": \"WebPageElement\",\n  \"isAccessibleForFree\": false,\n  \"cssSelector\": \".paywall-hidden\"\n },\n \"aggregateRating\": {\n  \"@type\": \"AggregateRating\",\n  \"ratingValue\": \"4.26\",\n  \"reviewCount\": 75\n },\n \"associatedMedia\": {\n  \"@type\": \"ImageObject\",\n  \"contentUrl\": \"https://res.cloudinary.com/hksqkdlah/image/upload/c_fill,dpr_2.0,f_auto,fl_lossy.progressive.strip_profile,g_faces:auto,q_auto:low/43118-sfs-sauteedportobellomushroomsredwinerosemary-33\",\n  \"description\": \"Sautéed Mushrooms with Red Wine and Rosemary\"\n },\n \"recipeCategory\": \"Side Dishes\",\n \"recipeCuisine\": \"\",\n \"keywords\": \"Vegetables,Quick,Easter\",\n \"video\": {\n  \"@type\": \"VideoObject\",\n  \"name\": \"Sautéed Mushrooms with Red Wine and Rosemary\",\n  \"thumbnailUrl\": [\n   \"https://res.cloudinary.com/hksqkdlah/image/upload/ar_1/ATK-S20_20190513_09-20-57_40919_kcqtqp\",\n   \"https://res.cloudinary.com/hksqkdlah/image/upload/ar_1.33/ATK-S20_20190513_09-20-57_40919_kcqtqp\",\n   \"https://res.cloudinary.com/hksqkdlah/image/upload/ar_0.5/ATK-S20_20190513_09-20-57_40919_kcqtqp\"\n  ],\n  \"embedUrl\": \"https://player.zype.com/embed/5ea9d130760f64000180bab3.html\",\n  \"uploadDate\": \"2019-12-17T18:53:30.165Z\"\n }\n}\n</script>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Sautéed Mushrooms with Red Wine and Rosemary",
      servings: 4,
      totalMinutes: 35,
      ingredients: [
        { amount: 1.25, unit: "lb", item: "mushrooms" },
        { amount: 0.25, unit: "cup", item: "water" },
        { amount: 0.5, unit: "tsp", item: "vegetable oil" },
        { amount: 1, unit: "tbsp", item: "unsalted butter" },
        { amount: 1, unit: null, item: "shallot" },
        { amount: 1, unit: "tsp", item: "minced fresh rosemary" },
        { amount: 0.25, unit: "tsp", item: "table salt" },
        { amount: 0.25, unit: "tsp", item: "pepper" },
        { amount: 0.25, unit: "cup", item: "red wine" },
        { amount: 1, unit: "tbsp", item: "cider vinegar" },
        { amount: 0.5, unit: "cup", item: "chicken broth" },
      ],
    },
  },
  notes: "KNOWN-WRONG FIXTURE. The URL is crispy-skin-pan-seared-chicken-breasts and the only Recipe node on the page is Sauteed Mushrooms. Tier 0 reads that correctly, so the expectation is the mushrooms - scoring it otherwise would mark a correct read wrong. The product behaviour is a confident wrong recipe with no signal, which is a trap worth a title-mismatch check of its own rather than a scoring question.",
};

export const smittenkitchen_chicken_salad: Fixture = {
  id: "smittenkitchen-chicken-salad",
  input: {
    kind: "url",
    url: "https://smittenkitchen.com/2026/05/chicken-salad-for-celery-enthusiasts/",
    capturedAt: "2026-08-15",
    text: "<!doctype html><html><body>\n<h1>chicken salad for celery&nbsp;enthusiasts</h1>\n<ul class=\"ingredients\">\n  <li class=\"ingredient\">2 bone-in skin-on chicken breasts (about 2 pounds)</li>\n  <li class=\"ingredient\">Olive oil</li>\n  <li class=\"ingredient\">Kosher salt</li>\n  <li class=\"ingredient\">Freshly ground black pepper</li>\n  <li class=\"ingredient\">3 to 4 large ribs celery, diced small (about 1 1/2 cups)</li>\n  <li class=\"ingredient\">3 scallions, all parts, minced</li>\n  <li class=\"ingredient\">1 tablespoon (15 grams) smooth Dijon mustard, plus more to taste</li>\n  <li class=\"ingredient\">3 tablespoons (40 grams) mayonnaise, plus more to taste</li>\n</ul>\n</body></html>",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: null,
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 2, unit: null, item: "bone-in skin-on chicken breasts" },
        { amount: null, unit: null, item: "Olive oil" },
        { amount: null, unit: null, item: "Kosher salt" },
        { amount: null, unit: null, item: "Freshly ground black pepper" },
        { amount: 4, unit: null, item: "large ribs celery" },
        { amount: 3, unit: null, item: "scallions" },
        { amount: 1, unit: "tbsp", item: "smooth Dijon mustard" },
        { amount: 3, unit: "tbsp", item: "mayonnaise" },
      ],
    },
  },
  notes: "No JSON-LD at all - tier 1 must read the markup. Title, servings and time are not in the captured ingredient markup, so all three are null and the capture would need widening to check them.",
};

export const meallime_listing: Fixture = {
  id: "meallime-listing",
  input: { kind: "url", url: "https://www.meallime.com/recipes" },
  expected: { outcome: "refusal", because: "not-a-recipe-page" },
};

export const tiktok_gordon_ramsay: Fixture = {
  id: "tiktok-gordon-ramsay",
  input: { kind: "url", url: "https://www.tiktok.com/@gordonramsayofficial/video/7036666579843640582" },
  expected: { outcome: "refusal", because: "unresolvable-source" },
};

export const instagram_post: Fixture = {
  id: "instagram-post",
  input: { kind: "url", url: "https://www.instagram.com/p/C-Xy1z3M-AB/" },
  expected: { outcome: "refusal", because: "unresolvable-source" },
};

export const reddit_grill_thread: Fixture = {
  id: "reddit-grill-thread",
  input: { kind: "url", url: "https://www.reddit.com/r/recipes/comments/1vk9733/what_are_the_best_recipes_on_a_grill/" },
  expected: { outcome: "refusal", because: "not-a-recipe-page" },
};

export const caption_texas_twinkies: Fixture = {
  id: "caption-texas-twinkies",
  input: {
    kind: "caption",
    text: "Texas Twinkies for the Super Bowl 🏈 🐄\nRecipe below 👇🏾\n��Set @traegergrills to 275*\n��Chop up left over brisket to fine shreds\n��Use half a block of @phillycreamchs cream cheese\n��Shred cheddar cheese to your desire\n��Mix all together\n��Cut open jalapeño and scoop out seeds\n��Fill the jalapeño with brisket and cheese mixture\n��Cover the jalapeño with the piece you cut from earlier and wrap in bacon\n��Season with your favorite rub\n��Put on traeger for 1 hour\n��Half way through put on traeger glaze\n��Cook for an additional 20-30 mins or until bacon is cooked and jalapeño is cooked to your liking!\n��Take em off and let em cool so you don't burn your mouth like me!\n��Enjoy 🤙🏾 27w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Texas Twinkies",
      servings: null,
      totalMinutes: 90,
      ingredients: [
        { amount: null, unit: null, item: "leftover brisket" },
        { amount: null, unit: null, item: "cream cheese" },
        { amount: null, unit: null, item: "cheddar cheese" },
        { amount: null, unit: null, item: "jalapeños" },
        { amount: null, unit: null, item: "bacon" },
        { amount: null, unit: null, item: "rub" },
        { amount: null, unit: null, item: "traeger glaze" },
      ],
    },
  },
};

export const caption_summer_toast_board: Fixture = {
  id: "caption-summer-toast-board",
  input: {
    kind: "caption",
    text: "If I could invite all of you to my house for a backyard barbecue, this is 100% what I'd start the night with. These toasts are full of the best summer produce June has to offer (strawberries, basil, corn, tomatoes, peaches). I grabbed it all at a great price from Meijer (love their produce selection!) and a few items from their Room & Retreat collection to upgrade our dining table. #ad #MeijerPartner\nHere are the toast details 🥖👇\n- Ricotta and corn: ricotta, 2 ears of corn tossed in brown butter, prosciutto, flaky salt, hot honey, and thyme\n- Strawberry balsamic: whipped feta (1 block feta blended with olive oil and a splash of cold water), diced strawberries, balsamic vinegar, sliced basil, chopped pistachios, flaky salt, balsamic glaze\n- Peach burrata: burrata cheese, grilled peaches, fresh tomatoes, flaky salt, drizzle of olive oil, thyme and basil\nPS: these are also so easy to customize! I recommend checking Meijer's Hot Deals for what's on sale to get creative💫\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: null,
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: null, unit: null, item: "ricotta", section: "Ricotta and corn" },
        { amount: 2, unit: null, item: "ears of corn", section: "Ricotta and corn" },
        { amount: null, unit: null, item: "prosciutto", section: "Ricotta and corn" },
        { amount: null, unit: null, item: "flaky salt", section: "Ricotta and corn" },
        { amount: null, unit: null, item: "hot honey", section: "Ricotta and corn" },
        { amount: null, unit: null, item: "thyme", section: "Ricotta and corn" },
        { amount: 1, unit: null, item: "block feta", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "olive oil", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "strawberries", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "balsamic vinegar", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "basil", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "pistachios", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "flaky salt", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "balsamic glaze", section: "Strawberry balsamic" },
        { amount: null, unit: null, item: "burrata cheese", section: "Peach burrata" },
        { amount: null, unit: null, item: "grilled peaches", section: "Peach burrata" },
        { amount: null, unit: null, item: "fresh tomatoes", section: "Peach burrata" },
        { amount: null, unit: null, item: "flaky salt", section: "Peach burrata" },
        { amount: null, unit: null, item: "olive oil", section: "Peach burrata" },
        { amount: null, unit: null, item: "thyme", section: "Peach burrata" },
        { amount: null, unit: null, item: "basil", section: "Peach burrata" },
      ],
    },
  },
};

export const caption_cinnamon_rolls: Fixture = {
  id: "caption-cinnamon-rolls",
  input: {
    kind: "caption",
    text: "the softest, fluffiest, perfectly sweetened cinnamon rolls i've ever made 🤎\nCINNAMON ROLLS RECIPE 🧸\nINGREDIENTS:\n(dough)\n- 3/4 cup warm milk\n- 2 1/2 tsp instant yeast\n- 1 tbsp sugar\n- 1/3 cup sugar\n- 2 eggs (whisked)\n- 3 cups all purpose flour\n- pinch of salt\n- 1/4 cup melted butter\n(filling)\n- 1/2 cup butter (room temp)\n- 1 cup (demerara) brown sugar (packed)\n- 2 tbsp cinnamon\n- eyeball some nutmeg\n(caramel for baking dish)\n- 1/4 cup brown sugar\n- 1/4 cup softened butter\n(cream cheese icing)\n- 1 block cream cheese (room temp)\n- 1/3 cup butter (room temp)\n- 2 splashes vanilla\n- 1 1/2 cup icing sugar\n- 2 tbsp milk\n(for baking)\n- heavy cream (1 tbsp for each roll)\nDIRECTIONS:\n1) Add yeast + 1 tbsp sugar to warm milk, stir and let that stand for 10 minutes to activate the yeast\n2) Add the rest of the dough ingredients to a bowl, add the yeast mixture and mix with a spatula until a dough forms. Then mix it in a stand mixer on the lowest setting with a dough hook for 8 minutes (dough will be slightly sticky)\n3) Place the dough in a lightly floured large bowl and cover with a damp cloth. Heat your oven to 175F until it warms up, turn it off and let your dough rest in there for 2 hours\n4) Combine your filling ingredients, roll out the dough, spread out the filling, use a pizza cutter to cut rolls (you do want thinner strips since they're gonna rise to get about 9-12 rolls). Make your caramel by whisking the ingredients until lighter in colour, then spread it on the bottom of a 9x13 ceramic dish. Place 8 rolls and cover again with a damp cloth for another 30 minutes on your counter (for any extra rolls make sure to bake it in a smaller ceramic dish where the rolls will touch and bake together + add more caramel to each baking dish)\n5) Add 1 tbsp heavy cream to each cinnamon roll, then bake at 350F for 25 minutes\n6) For the cream cheese icing, blend all the ingredients in a food processor, then spread onto hot cinnamon rolls (perfectly sweetened and has a thinner consistency)\n#cinnamonroll #baking #aestheticbaking #dessert #recipe\nEdited · 23w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Cinnamon Rolls",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 0.75, unit: "cup", item: "warm milk", section: "dough" },
        { amount: 2.5, unit: "tsp", item: "instant yeast", section: "dough" },
        { amount: 1, unit: "tbsp", item: "sugar", section: "dough" },
        { amount: 0.333, unit: "cup", item: "sugar", section: "dough" },
        { amount: 2, unit: null, item: "eggs", section: "dough" },
        { amount: 3, unit: "cup", item: "all purpose flour", section: "dough" },
        { amount: null, unit: null, item: "salt", section: "dough" },
        { amount: 0.25, unit: "cup", item: "melted butter", section: "dough" },
        { amount: 0.5, unit: "cup", item: "butter", section: "filling" },
        { amount: 1, unit: "cup", item: "brown sugar", section: "filling" },
        { amount: 2, unit: "tbsp", item: "cinnamon", section: "filling" },
        { amount: null, unit: null, item: "nutmeg", section: "filling" },
        { amount: 0.25, unit: "cup", item: "brown sugar", section: "caramel for baking dish" },
        { amount: 0.25, unit: "cup", item: "softened butter", section: "caramel for baking dish" },
        { amount: 1, unit: null, item: "block cream cheese", section: "cream cheese icing" },
        { amount: 0.333, unit: "cup", item: "butter", section: "cream cheese icing" },
        { amount: null, unit: null, item: "vanilla", section: "cream cheese icing" },
        { amount: 1.5, unit: "cup", item: "icing sugar", section: "cream cheese icing" },
        { amount: 2, unit: "tbsp", item: "milk", section: "cream cheese icing" },
        { amount: null, unit: null, item: "heavy cream", section: "for baking" },
      ],
    },
  },
};

export const caption_sheet_pan_crunchwrap: Fixture = {
  id: "caption-sheet-pan-crunchwrap",
  input: {
    kind: "caption",
    text: "Sheet Pan Crunchwrap Supreme 🌮🔔\nComment \"Recipe\" and I'll send you the full recipe for free.\nThis is the easiest way to make crunchwraps at home. It feeds a whole family, costs way less than takeout, and tastes even better.\nIf you're always looking for new dinner ideas, you're in the right place. That's why I share simple and affordable meals that save you time and money.\nFollow for more weeknight staples.\nIngredients\nCrunchwrap\n• 8 burrito-size tortillas\n• 2 lb ground beef\n• 1 cup beef broth\n• 6 tbsp taco seasoning (or homemade: 3 tbsp chili powder, 3 tbsp cumin, 2 tbsp garlic powder, 2 tbsp paprika, 1 tbsp onion powder, 1 tbsp oregano, 1 tbsp salt, 1 tbsp black pepper)\n• 1½ cups shredded cheddar cheese\n• 6 tostadas\n• 2 cups shredded lettuce\n• 2 tomatoes, diced\n• 1 cup sour cream\n• 3 tbsp butter, melted\nCreamy Taco Sauce\n• ⅓ cup sour cream or Greek yogurt\n• ⅓ cup mayonnaise\n• ⅓ cup milk or water\n• Juice of 1 lime\n• 1 tbsp taco seasoning\n• 1 tbsp dried parsley\n• ½ tsp paprika\n• ½ tsp garlic powder\nInstructions\n1. Lay the tortillas around the edges of a sheet pan so the centers sit on the lip of the pan, then place one tortilla flat in the middle. Spread about ¾ cup sour cream across the tortillas.\n2. In a skillet, cook the ground beef with taco seasoning and beef broth until browned and the liquid is absorbed. Optional: For extra flavor, add 1 diced onion and 6 cloves of minced garlic.\n3. Add the beef over the sour cream, then layer shredded cheese, tostadas, shredded lettuce, and diced tomatoes.\n4. Add a tortilla with the remaining 1/4 cup sour cream in the middle. Fold the tortillas over the top to fully enclose everything, then brush with melted butter.\n5. Top with another baking sheet and bake at 420°F for 20 minutes. Remove the top sheet and bake for another 7 minutes until golden and crispy.\nSauce\n1. Add all ingredients to a bowl.\n2. Whisk until smooth and fully combined.\n3. Let sit for 15–30 minutes in the fridge if you have time.\n#easydinners #crunchwrap\nEdited · 18w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Sheet Pan Crunchwrap Supreme",
      servings: null,
      totalMinutes: 27,
      ingredients: [
        { amount: 8, unit: null, item: "burrito-size tortillas", section: "Crunchwrap" },
        { amount: 2, unit: "lb", item: "ground beef", section: "Crunchwrap" },
        { amount: 1, unit: "cup", item: "beef broth", section: "Crunchwrap" },
        { amount: 6, unit: "tbsp", item: "taco seasoning", section: "Crunchwrap" },
        { amount: 1.5, unit: "cup", item: "shredded cheddar cheese", section: "Crunchwrap" },
        { amount: 6, unit: null, item: "tostadas", section: "Crunchwrap" },
        { amount: 2, unit: "cup", item: "shredded lettuce", section: "Crunchwrap" },
        { amount: 2, unit: null, item: "tomatoes", section: "Crunchwrap" },
        { amount: 1, unit: "cup", item: "sour cream", section: "Crunchwrap" },
        { amount: 3, unit: "tbsp", item: "butter", section: "Crunchwrap" },
        { amount: 0.333, unit: "cup", item: "sour cream", section: "Creamy Taco Sauce" },
        { amount: 0.333, unit: "cup", item: "mayonnaise", section: "Creamy Taco Sauce" },
        { amount: 0.333, unit: "cup", item: "milk", section: "Creamy Taco Sauce" },
        { amount: 1, unit: null, item: "lime", section: "Creamy Taco Sauce" },
        { amount: 1, unit: "tbsp", item: "taco seasoning", section: "Creamy Taco Sauce" },
        { amount: 1, unit: "tbsp", item: "dried parsley", section: "Creamy Taco Sauce" },
        { amount: 0.5, unit: "tsp", item: "paprika", section: "Creamy Taco Sauce" },
        { amount: 0.5, unit: "tsp", item: "garlic powder", section: "Creamy Taco Sauce" },
      ],
    },
  },
};

export const caption_chile_lime_chicken_bowl: Fixture = {
  id: "caption-chile-lime-chicken-bowl",
  input: {
    kind: "caption",
    text: "Chile Lime Chicken Bowl Ingredients: Pineapple Mango Salsa (Makes 2 servings): 1/2 cup diced mango 1/2 cup diced pineapple 1 tbsp diced jalapeño 2 tbsp diced red onion 1/2 tbsp chopped cilantro 1/4 tsp chile lime seasoning Juice from 1/2 a lime (about 1 tbsp) Chicken Marinade: 2 tbsp plain Greek yogurt 1/2 tsp chopped cilantro 1/2 tsp chile lime seasoning 1/4 tsp garlic powder 1 tbsp lime juice Pepper, to taste 2 boneless, skinless chicken thighs (180g) For Serving: 1/2 cup cilantro lime rice Additional lime juice (optional) Instructions: Prepare the Salsa: In a bowl, mix diced mango, pineapple, jalapeño, red onion, cilantro, chile lime seasoning, and lime juice. Set aside. Marinate the Chicken: In a separate bowl, combine Greek yogurt, cilantro, chile lime seasoning, garlic powder, lime juice, and pepper. Coat the chicken thighs evenly and let marinate for at least 20 minutes. Cook the Chicken: Heat a pan over medium-high heat and spray with olive oil. Cook chicken for 4 minutes per side or until the internal temperature reaches 165°F (75°C). Assemble the Bowl: Serve the cooked chicken with 1/2 cup cilantro lime rice and 1/2 cup pineapple mango salsa. Finish & Enjoy: Top with additional lime juice if desired and serve immediately.\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Chile Lime Chicken Bowl",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 0.5, unit: "cup", item: "diced mango", section: "Pineapple Mango Salsa" },
        { amount: 0.5, unit: "cup", item: "diced pineapple", section: "Pineapple Mango Salsa" },
        { amount: 1, unit: "tbsp", item: "diced jalapeño", section: "Pineapple Mango Salsa" },
        { amount: 2, unit: "tbsp", item: "diced red onion", section: "Pineapple Mango Salsa" },
        { amount: 0.5, unit: "tbsp", item: "chopped cilantro", section: "Pineapple Mango Salsa" },
        { amount: 0.25, unit: "tsp", item: "chile lime seasoning", section: "Pineapple Mango Salsa" },
        { amount: 0.5, unit: null, item: "lime", section: "Pineapple Mango Salsa" },
        { amount: 2, unit: "tbsp", item: "plain Greek yogurt", section: "Chicken Marinade" },
        { amount: 0.5, unit: "tsp", item: "chopped cilantro", section: "Chicken Marinade" },
        { amount: 0.5, unit: "tsp", item: "chile lime seasoning", section: "Chicken Marinade" },
        { amount: 0.25, unit: "tsp", item: "garlic powder", section: "Chicken Marinade" },
        { amount: 1, unit: "tbsp", item: "lime juice", section: "Chicken Marinade" },
        { amount: null, unit: null, item: "pepper", section: "Chicken Marinade" },
        { amount: 2, unit: null, item: "boneless, skinless chicken thighs", section: "Chicken Marinade" },
        { amount: 0.5, unit: "cup", item: "cilantro lime rice", section: "For Serving" },
        { amount: null, unit: null, item: "lime juice", section: "For Serving" },
      ],
    },
  },
};

export const caption_homemade_burger_buns: Fixture = {
  id: "caption-homemade-burger-buns",
  input: {
    kind: "caption",
    text: "Homemade burger buns 1 cup warm water (110 degrees F) 2 tbsp sugar 2 tsp active dry yeast 3 1/2 cups all purpose flour 1 tsp salt 1 egg 1/4 cup neutral oil 400 for 12 minutes Make sure to save this one in @recime.app ! #recimepartner #bakingrecipes #easybaking #baking #burgerbuns\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Homemade burger buns",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 1, unit: "cup", item: "warm water" },
        { amount: 2, unit: "tbsp", item: "sugar" },
        { amount: 2, unit: "tsp", item: "active dry yeast" },
        { amount: 3.5, unit: "cup", item: "all purpose flour" },
        { amount: 1, unit: "tsp", item: "salt" },
        { amount: 1, unit: null, item: "egg" },
        { amount: 0.25, unit: "cup", item: "neutral oil" },
      ],
    },
  },
};

export const caption_boursin_sausage_pasta: Fixture = {
  id: "caption-boursin-sausage-pasta",
  input: {
    kind: "caption",
    text: "Looking for an easy dinner recipe that's packed with flavor? This 4-ingredient Creamy Tomato Pasta with Sausage and Boursin Cheese is the ultimate one-pot meal for busy weeknights! Made with rich tomato basil sauce, creamy garlic and herb Boursin Cheese, Italian sausage, and your favorite pasta, it's like a dreamy combo of vodka sauce and bolognese without the effort. Ready in just 20 minutes, it's perfect for a quick pasta recipe that feels fancy but is so simple to make. PS: If you're vegetarian, skip the sausage, and it's just as creamy and delicious. Trust me, this is going to be your new go-to dinner idea for those busy holiday weeknights!\n🩷 Comment \"cheese please\" to get the full recipe sent straight to your inbox!\n⭐️INGREDIENTS ⭐️\n1 lb Rigatoni Pasta\n1 lb Italian Sausage (@jimmydean)\n1 24oz Jar Tomato Basil Sauce (@carbonefinefood)\n5.3 oz @boursincheese with Garlic & Fine Herbs\n⭐️ INSTRUCTIONS ⭐️\n1️⃣Get a pot of salted water boiling for your pasta. Once boiling, add pasta and cook the pasta al dente as specified time on the box. Once it's done, strain the pasta but reserve a cup of pasta water for later.\n2️⃣ Meanwhile, add sausage to a large sauce pan or braiser heated over medium-high heat. Use a spatula or meat masher to break the sausage up into tiny crumbles.\n3️⃣ Once the sausage is cooked through, it's time to add the Boursin Cheese and the jar of tomato sauce. Turn the heat down to medium and stir the sauce mixture.\n4️⃣ Once melted, add in the al dente pasta and stir to combine. Once all the pasta is coated in the sauce, add half a cup of the reserved pasta water and toss once more.\n5️⃣ Taste and season with salt and pepper if needed before serving. Optional, but you can also serve with parmigiano if you wish.\n🩷 Or get the full recipe through the link on my profile page at this address - https://grilledcheesesocial.com/2024/05/17/4-ingredient-sausage-boursin-cheese-pasta-recipe/\n87w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Creamy Tomato Pasta with Sausage and Boursin Cheese",
      servings: null,
      totalMinutes: 20,
      ingredients: [
        { amount: 1, unit: "lb", item: "Rigatoni Pasta" },
        { amount: 1, unit: "lb", item: "Italian Sausage" },
        { amount: 24, unit: "oz", item: "Jar Tomato Basil Sauce" },
        { amount: 5.3, unit: "oz", item: "Boursin cheese with Garlic & Fine Herbs" },
      ],
    },
  },
};

export const caption_one_pot_boursin_pasta: Fixture = {
  id: "caption-one-pot-boursin-pasta",
  input: {
    kind: "caption",
    text: "@krolls_korner ONE POT BOURSIN PASTA 😍😮‍💨 comment \"recipe\" and I'll dm you the recipe link! Really good with chicken, chicken sausage, fish, steak..everything! 👌🏼\n.\nIngredients\n▢ 4 Tbsp. butter, unsalted (divided)\n▢ 2-3 cloves garlic (finely minced)\n▢ 1 ½ cups uncooked ditalini pasta\n▢ 2 1/2 cups chicken broth (or more as needed )\n▢ ⅓ cup heavy cream (or more as desired)\n▢ salt, black pepper, chili flakes to taste\n▢ 5.3 oz. garlic and fine herbs Boursin cheese (room temp)\n▢ squeeze of fresh lemon juice (1-2 Tbsp.)\n▢ fresh basil, parmesan, and chili flakes for garnish\n.\nhttps://krollskorner.com/ingredient/pasta/one-pot-boursin-pasta/\n.\n#boursin #boursincheese #easyrecipeideas #pastarecipe #krollskorner\n16w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "One Pot Boursin Pasta",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 4, unit: "tbsp", item: "butter, unsalted" },
        { amount: 3, unit: "clove", item: "garlic" },
        { amount: 1.5, unit: "cup", item: "uncooked ditalini pasta" },
        { amount: 2.5, unit: "cup", item: "chicken broth" },
        { amount: 0.333, unit: "cup", item: "heavy cream" },
        { amount: null, unit: null, item: "salt, black pepper, chili flakes" },
        { amount: 5.3, unit: "oz", item: "garlic and fine herbs Boursin cheese" },
        { amount: 2, unit: "tbsp", item: "fresh lemon juice" },
        { amount: null, unit: null, item: "fresh basil, parmesan, and chili flakes for garnish" },
      ],
    },
  },
};

export const caption_peach_posset: Fixture = {
  id: "caption-peach-posset",
  input: {
    kind: "caption",
    text: "A peaches and cream dream 😍 🍑 A take on my chai apple possets, these peach possets are sweet, juicy and the perfect summer dessert.\nFull Recipe 👇\n4 medium ripe peaches\n2 cups heavy cream\n1/3 cup sugar\n3 Tbsp lemon juice\n2 tsp vanilla bean paste\nBrown butter peaches: 3 Tbsp unsalted butter, 1 Tbsp brown sugar, pinch of cinnamon\nCut the peaches in half and hollow out the center with a spoon, leaving about 1/4 inch around the edges. Diced the peaches you scooped out, toss with lemon juice, cover and refrigerate.\nHeat the cream and sugar over medium heat until it gently boils. Continue with a gentle boil (stirring often) for 5 full minutes. Remove from the heat and stir in the lmeon juice and vanilla. Strain through a sieve into a measuring cup with a lip.\nPour the cream mixture into the hollowed out peachesand chill for at least 3 hours.\nBefore serving, brown the butter in a small saucepan. Add the reserved diced peaches, brown sugar, and cinnamon and cook for a minute or so on low until just softened. Spoon over the chilled possets. Top with whipped cream, a drizzle of the brown butter from the bottom of the pan, and a sprinkling of brown sugar.\n👉You can also comment 'recipe' and I'll send it to your DMs to save!\nhttps://whatmollymade.com/peach-posset/\n#peachrecipe #summerdessert #peachposset #easydessert\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Peach Possets",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 4, unit: null, item: "medium ripe peaches" },
        { amount: 2, unit: "cup", item: "heavy cream" },
        { amount: 0.333, unit: "cup", item: "sugar" },
        { amount: 3, unit: "tbsp", item: "lemon juice" },
        { amount: 2, unit: "tsp", item: "vanilla bean paste" },
        { amount: 3, unit: "tbsp", item: "unsalted butter", section: "Brown butter peaches" },
        { amount: 1, unit: "tbsp", item: "brown sugar", section: "Brown butter peaches" },
        { amount: null, unit: null, item: "cinnamon", section: "Brown butter peaches" },
      ],
    },
  },
};

export const caption_potato_sausage_soup: Fixture = {
  id: "caption-potato-sausage-soup",
  input: {
    kind: "caption",
    text: "If we're calling it Augtober, then soup is no longer optional. 🍁\nWho's with me? 🤎\nSoup recipe below! 👇🏼\nCreamy Potato & Sausage Soup\n(I use my instant pot for this but you can use a slow cooker)\nIngredients\n• 1 lb Italian sausage (mild or spicy, your choice)\n• 6 medium russet or gold potatoes, diced into small cubes\n• 1 medium onion, diced\n• 3 cloves garlic, minced\n• 3 medium carrots, diced\n• 3 stalks celery, diced\n• 6 cups chicken broth\n• 1 ½ tsp salt (adjust to taste)\n• ½ tsp black pepper\n• 1 tsp dried thyme (or Italian seasoning)\n• ½ tsp paprika (optional, for warmth)\n• 1 cup heavy cream (or half-and-half for lighter)\n• 2 cups chopped kale or spinach\n• 2 tbsp flour + 2 tbsp butter (optional, for extra thickness)\nInstructions\n1. Cook sausage first: Cook sausage until browned, breaking it up into small pieces. Drain excess grease if needed.\n2. Add veggies & broth: Add potatoes, onion, garlic, carrots, celery, broth, salt, pepper, thyme, and paprika. Stir well.\n3. Slow cook: Put the lid on, set the valve to venting (since it's slow cook mode), and cook on Slow Cook – Normal for 6–7 hours or Slow Cook – High for 3–4 hours, until potatoes are tender.\n4. Make it creamy: About 30 minutes before serving, stir in the heavy cream. If you want it thicker, melt butter in a small pan, whisk in flour, then stir this roux into the soup.\n5. Add greens: Stir in kale or spinach and let it wilt during the last 5–10 minutes of cook time.\n6. Serve: Taste and adjust seasoning if needed. Ladle into bowls and serve warm with crusty bread.\n•\n•\n•\n•\n•\n#homemade #recipe #soup #autumn #simple\n2w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Creamy Potato & Sausage Soup",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 1, unit: "lb", item: "Italian sausage" },
        { amount: 6, unit: null, item: "medium russet or gold potatoes" },
        { amount: 1, unit: null, item: "medium onion" },
        { amount: 3, unit: "clove", item: "garlic" },
        { amount: 3, unit: null, item: "medium carrots" },
        { amount: 3, unit: null, item: "stalks celery" },
        { amount: 6, unit: "cup", item: "chicken broth" },
        { amount: 1.5, unit: "tsp", item: "salt" },
        { amount: 0.5, unit: "tsp", item: "black pepper" },
        { amount: 1, unit: "tsp", item: "dried thyme" },
        { amount: 0.5, unit: "tsp", item: "paprika" },
        { amount: 1, unit: "cup", item: "heavy cream" },
        { amount: 2, unit: "cup", item: "chopped kale or spinach" },
        { amount: 2, unit: "tbsp", item: "flour" },
        { amount: 2, unit: "tbsp", item: "butter" },
      ],
    },
  },
};

export const caption_marry_me_sausage_soup: Fixture = {
  id: "caption-marry-me-sausage-soup",
  input: {
    kind: "caption",
    text: "💍 MARRY ME ITALIAN SAUSAGE SOUP for Valentine's Day and anytime that cozy soup craving hits—THIS is a winner 🏆 and I can't wait to see your remakes! You can use any pasta shape you want and because the pasta cooks in the soup, it's a low effort, easy clean up meal that might just land you a marriage proposal—I guess there's only one way to find out 😏!⁣\n⁣\nMakes 6 servings ⁣\n1/2 cup sundried tomatoes, in oil⁣\n1 lb mild or spicy Italian sausage ⁣\n1/2 white onion, finely diced⁣\n1 red bell pepper, diced⁣\n3 cloves garlic, minced ⁣\n6 cups chicken broth⁣\n2 tsp Italian seasoning⁣\n1 tsp crushed red pepper flakes⁣\n1 tsp kosher salt⁣\n3/4 cup dried pasta of choice (I'm using gluten-free pasta)⁣\n3/4 cup heavy cream or coconut milk⁣\n3 cups spinach⁣\n1/3 cup fresh basil, chopped ⁣\n3/4 cup parmesan cheese, freshly grated⁣\n⁣\nFirst, slice the sundried tomatoes into pieces and set aside. Chop the onion, bell pepper, and mince your onion. Use 2 tb of the oil from the sundried tomato jar and add it to a large pot over medium heat. Once the pot is hot, add the sausage. Mash into smaller pieces and once almost cooked through, add the onion, pepper, and garlic. Stir for 4-5 minutes until the veggies have softened then add in the chicken broth, sun-dried tomatoes, italian seasoning, red pepper flakes, and salt. Stir and bring to a gentle simmer then add in the pasta and let cook for 4-5 minutes, stirring, then reduce heat to low and add the heavy cream, spinach, and basil, stirring until fully incorporated and the spinach has wilted. Let cook for 3-4 more minutes or until the pasta is al dente. Remove from heat and stir in the parmesan cheese. Divide into bowls and serve with more parmesan cheese on top. Enjoy!⁣\nUsing: @shamrockfarmsmilk cream @parmigianoreggiano.na parm @staub_usa pot @thegiadzy gluten-free taccole corte pasta @mezzetta sundried tomatoes\n⁣\nSoup recipes | marry me chicken | valentines day recipes | budget friendly recipes | one pot meals | quick dinners\n26w\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Marry Me Italian Sausage Soup",
      servings: 6,
      totalMinutes: null,
      ingredients: [
        { amount: 0.5, unit: "cup", item: "sundried tomatoes, in oil" },
        { amount: 1, unit: "lb", item: "mild or spicy Italian sausage" },
        { amount: 0.5, unit: null, item: "white onion" },
        { amount: 1, unit: null, item: "red bell pepper" },
        { amount: 3, unit: "clove", item: "garlic" },
        { amount: 6, unit: "cup", item: "chicken broth" },
        { amount: 2, unit: "tsp", item: "Italian seasoning" },
        { amount: 1, unit: "tsp", item: "crushed red pepper flakes" },
        { amount: 1, unit: "tsp", item: "kosher salt" },
        { amount: 0.75, unit: "cup", item: "dried pasta of choice" },
        { amount: 0.75, unit: "cup", item: "heavy cream or coconut milk" },
        { amount: 3, unit: "cup", item: "spinach" },
        { amount: 0.333, unit: "cup", item: "fresh basil" },
        { amount: 0.75, unit: "cup", item: "parmesan cheese" },
      ],
    },
  },
};

export const caption_chicken_pad_thai: Fixture = {
  id: "caption-chicken-pad-thai",
  input: {
    kind: "caption",
    text: "30-MIN SAUCY CHICKEN PAD THAI ✨ one of the best dinners I've made in so long. And no this is not traditional pad thai—it's my take. The problem with most pad thai recipes is that I always feel like they need more sauce! Like why are the noodles so dry? Well not this recipe—the sauce soaks up into the rice noodles so you get that delicious sauce in every bite! Makes 4-6 servings PAD THAI 14 oz rice noodles (stir fry or pad thai noodles) 1 tb olive oil 1 lb boneless skinless chicken thighs, cut into bite size pieces 2 tb low sodium soy sauce 1 cup bean sprouts 1 red bell pepper, seed removed and sliced thin 1 cup shredded carrots 3 cloves garlic, mashed 2 eggs 1 cup green onions, sliced thin (this is ~1 bunch) ½ cup cilantro 1 lime, juiced 1/2 tsp red pepper flakes SAUCE 1/2 cup low sodium soy sauce or tamari 2 tb toasted sesame oil 3 tb fish sauce 1/3 cup coconut sugar 3 tb rice vinegar 1/4 cup creamy natural peanut butter 1 tsp ground ginger GARNISH 1/3 cup chopped peanuts 1 lime, juiced and drizzled on top Cook noodles according to package instructions. Drain and set aside. Heat the olive oil in a large pan over medium heat, and once hot, add the chicken pieces and soy sauce. Cook for about 7-8 minutes, until browned on all sides and almost cooked through. Transfer the chicken from the pan to a plate, leaving the oil and juices from the chicken. Add the bean sprouts, bell pepper, carrots and garlic. Cook until the veggies have softened, about 4 minutes. While those are cooking, make the sauce. Add all sauce ingredients to a blender and blend until smooth and set aside. Once the veggies are done, push them to the side of the pan. Crack both eggs in the pan and scramble them. Combine with the veggies. Add the chicken, drained noodles, green onions, cilantro, lime, pepper flakes, and sauce to the pan. Toss to combine. Plate and top with additional cilantro, chopped peanuts, and a squeeze of lime. Enjoy! q#padthai #easyrecipes #healthydinner See less\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "30-Min Saucy Chicken Pad Thai",
      servings: 6,
      totalMinutes: 30,
      ingredients: [
        { amount: 14, unit: "oz", item: "rice noodles", section: "PAD THAI" },
        { amount: 1, unit: "tbsp", item: "olive oil", section: "PAD THAI" },
        { amount: 1, unit: "lb", item: "boneless skinless chicken thighs", section: "PAD THAI" },
        { amount: 2, unit: "tbsp", item: "low sodium soy sauce", section: "PAD THAI" },
        { amount: 1, unit: "cup", item: "bean sprouts", section: "PAD THAI" },
        { amount: 1, unit: null, item: "red bell pepper", section: "PAD THAI" },
        { amount: 1, unit: "cup", item: "shredded carrots", section: "PAD THAI" },
        { amount: 3, unit: "clove", item: "garlic", section: "PAD THAI" },
        { amount: 2, unit: null, item: "eggs", section: "PAD THAI" },
        { amount: 1, unit: "cup", item: "green onions", section: "PAD THAI" },
        { amount: 0.5, unit: "cup", item: "cilantro", section: "PAD THAI" },
        { amount: 1, unit: null, item: "lime", section: "PAD THAI" },
        { amount: 0.5, unit: "tsp", item: "red pepper flakes", section: "PAD THAI" },
        { amount: 0.5, unit: "cup", item: "low sodium soy sauce or tamari", section: "SAUCE" },
        { amount: 2, unit: "tbsp", item: "toasted sesame oil", section: "SAUCE" },
        { amount: 3, unit: "tbsp", item: "fish sauce", section: "SAUCE" },
        { amount: 0.333, unit: "cup", item: "coconut sugar", section: "SAUCE" },
        { amount: 3, unit: "tbsp", item: "rice vinegar", section: "SAUCE" },
        { amount: 0.25, unit: "cup", item: "creamy natural peanut butter", section: "SAUCE" },
        { amount: 1, unit: "tsp", item: "ground ginger", section: "SAUCE" },
        { amount: 0.333, unit: "cup", item: "chopped peanuts", section: "GARNISH" },
        { amount: 1, unit: null, item: "lime", section: "GARNISH" },
      ],
    },
  },
};

export const caption_lemony_shrimp_orzo: Fixture = {
  id: "caption-lemony-shrimp-orzo",
  input: {
    kind: "caption",
    text: "ONE PAN CREAMY LEMONY SHRIMP AND ORZO, a new one since I drop salmon recipes often and I've had requests for other seafood meals—here you go, KJ fam!. I love a good one pan meal that has all the comfort vibes and if you do too, this is the one you need to make. The shrimp cooks in lemon and butter and then it gets added to the same pan with the lemony orzo and you have dinner on the table in ~20 minutes from start to finish. This one is a WINNER like omgeeee so good and I cannot wait for you to make it! ⁣ ⁣ Be sure to FOLLOW me @kalejunkie for more dinners like this, SAVE this post and SHARE it with your friends :)⁣ ⁣ Makes 6 servings⁣ SHRIMP:⁣ 2 tb butter⁣ 1 1/2 lbs medium shrimp peeled and deveined, patted dry with a paper towel⁣ 2 tb lemon zest⁣ 2 tb lemon juice⁣ ⁣ ORZO:⁣ 1 tb olive oil⁣ 2 large shallots, very finely diced⁣ 4 cloves garlic, mashed⁣ 2 3/4 cups chicken broth⁣ 1/2 cup white wine of choice⁣ 1 cup orzo⁣ 1 tsp kosher salt⁣ 1 tsp ground black pepper⁣ 1/2 cup freshly grated parmigiano reggiano cheese⁣ 1/2 cup heavy cream (or full fat coconut milk from the can)⁣ 2 tb lemon juice⁣ 1/4 cup parsley, finely chopped⁣ 3 tb fresh fill, finely chopped⁣ ⁣ Melt 2 tb of butter in a large pan over medium heat. Once the pan is hot, add the shrimp, lemon zest and lemon juice and stir until the shrimp is cooked through, about 4 minutes or so. Once cooked, remove the shrimp from the pan. Add the olive oil, shallots and garlic, stirring for 1-2 minutes and scraping down any of the bits stuck to the bottom of the pan. Next, add in the broth, wine, orzo, salt and pepper, stirring again. Bring to a gentle boil, then reduce heat to medium-low, stirring occasionally, until the orzo is cooked though, about 7-8 minutes. Finally, stir in the cheese, heavy cream, lemon juice, parsley and dill mixing again. Add the cooked shrimp back to the pan and coat the shrimp with the orzo. Serve and enjoy with additional herbs and/or extra lemon zest and parmesan cheese. ENJOY! ⁣ ⁣\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "One Pan Creamy Lemony Shrimp and Orzo",
      servings: 6,
      totalMinutes: 20,
      ingredients: [
        { amount: 2, unit: "tbsp", item: "butter", section: "SHRIMP" },
        { amount: 1.5, unit: "lb", item: "medium shrimp", section: "SHRIMP" },
        { amount: 2, unit: "tbsp", item: "lemon zest", section: "SHRIMP" },
        { amount: 2, unit: "tbsp", item: "lemon juice", section: "SHRIMP" },
        { amount: 1, unit: "tbsp", item: "olive oil", section: "ORZO" },
        { amount: 2, unit: null, item: "large shallots", section: "ORZO" },
        { amount: 4, unit: "clove", item: "garlic", section: "ORZO" },
        { amount: 2.75, unit: "cup", item: "chicken broth", section: "ORZO" },
        { amount: 0.5, unit: "cup", item: "white wine of choice", section: "ORZO" },
        { amount: 1, unit: "cup", item: "orzo", section: "ORZO" },
        { amount: 1, unit: "tsp", item: "kosher salt", section: "ORZO" },
        { amount: 1, unit: "tsp", item: "ground black pepper", section: "ORZO" },
        { amount: 0.5, unit: "cup", item: "freshly grated parmigiano reggiano cheese", section: "ORZO" },
        { amount: 0.5, unit: "cup", item: "heavy cream", section: "ORZO" },
        { amount: 2, unit: "tbsp", item: "lemon juice", section: "ORZO" },
        { amount: 0.25, unit: "cup", item: "parsley", section: "ORZO" },
        { amount: 3, unit: "tbsp", item: "fresh fill", section: "ORZO" },
      ],
    },
  },
};

export const caption_coconut_curry_brothy_rice: Fixture = {
  id: "caption-coconut-curry-brothy-rice",
  input: {
    kind: "caption",
    text: "PAN SEARED CHICKEN W/COCONUT CURRY BROTHY RICE aka my latest hyper fixation meal and it is easy to make! You simply pan sear chicken thighs and then make the most flavorful coconut curry broth that gets poured directly over warm rice, for the ultimate comfort food experience. All I have to say is that you must—MUST—make this and report back because it is amazing. ⁣ ⁣ SAVE this post, SHARE with friends, and FOLLOW me @kalejunkie for more!!⁣ ⁣ Makes 4 servings⁣ For the chicken:⁣ 2 tsp avocado oil⁣ 4 boneless, skinless chicken thighs⁣ Salt & pepper⁣ 1/4 cup chicken broth⁣ ⁣ For the broth:⁣ 2 tsp avocado oil⁣ 2 tsp ginger, grated or ginger paste⁣ 3 cloves garlic, minced⁣ 2-3 tb red curry paste (depending on your spice preference)⁣ 1 tb Better than Bouillon ⁣ 3/4 cup chicken broth⁣ 1 14 oz can full fat coconut milk⁣ 1 tsp fish sauce⁣ 1 lime, juiced⁣ ⁣ 2 cups cooked jasmine rice (to save time, I buy frozen and then microwave it!)⁣ 2 green onions, sliced⁣ 2 tb cilantro, chopped, for garnish⁣ 2 tsp chili oil for garish (optional) - I used @flybyjing which has peanuts in it :)⁣ Additional lime wedges⁣ ⁣ Pat chicken dry with paper towels and season with salt and pepper. Heat oil in a large skillet over medium heat. Add chicken thighs to the skillet. Cook for 5-7 minutes without moving (VERY IMPORTANT), and then flip only when the chicken easily releases on its own. Cook for 7-10 minutes more. Pour in the chicken broth to deglaze the bottom and sides of pan with the crispy browned bits until they're no longer sticking to the pan. Remove from heat and let chicken cool on a cutting board before slicing. Next, make the sauce. In a saucepan over medium heat, add the avocado oil. Once hot, add the ginger and garlic, stirring for one minute, then adding in the curry, bouillon and broth. Stir for another 2 minutes then add in the coconut milk, fish sauce and lime. Cover, reduce heat to low and let simmer for 5 minutes. Make rice your preferred way. Assemble your bowls with rice on the bottom, 1 sliced chicken breast, and a generous pour of the broth on top. Garnish with green onions, cilantro and chili oil. Serve with lime wedges. ENJOY!⁣ #brothyrice\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Pan Seared Chicken w/Coconut Curry Brothy Rice",
      servings: 4,
      totalMinutes: null,
      ingredients: [
        { amount: 2, unit: "tsp", item: "avocado oil", section: "For the chicken" },
        { amount: 4, unit: null, item: "boneless, skinless chicken thighs", section: "For the chicken" },
        { amount: null, unit: null, item: "Salt & pepper", section: "For the chicken" },
        { amount: 0.25, unit: "cup", item: "chicken broth", section: "For the chicken" },
        { amount: 2, unit: "tsp", item: "avocado oil", section: "For the broth" },
        { amount: 2, unit: "tsp", item: "ginger", section: "For the broth" },
        { amount: 3, unit: "clove", item: "garlic", section: "For the broth" },
        { amount: 3, unit: "tbsp", item: "red curry paste", section: "For the broth" },
        { amount: 1, unit: "tbsp", item: "Better than Bouillon", section: "For the broth" },
        { amount: 0.75, unit: "cup", item: "chicken broth", section: "For the broth" },
        { amount: 14, unit: "oz", item: "full fat coconut milk", section: "For the broth" },
        { amount: 1, unit: "tsp", item: "fish sauce", section: "For the broth" },
        { amount: 1, unit: null, item: "lime", section: "For the broth" },
        { amount: 2, unit: "cup", item: "cooked jasmine rice" },
        { amount: 2, unit: null, item: "green onions" },
        { amount: 2, unit: "tbsp", item: "cilantro" },
        { amount: 2, unit: "tsp", item: "chili oil" },
        { amount: null, unit: null, item: "lime wedges" },
      ],
    },
  },
};

export const caption_pb_cookie_dough_smores_bites: Fixture = {
  id: "caption-pb-cookie-dough-smores-bites",
  input: {
    kind: "caption",
    text: "PB COOKIE DOUGH S'MORES BITES, one of my fav sweet treats to always have on hand! The base is melted chocolate, then there's a thick layer of edible cookie dough mixed with crushed peanut butter cups, marshmallows, and a little more chocolate. Freeze and pop out a square or two anytime the sweet craving hits! SAVE this post, SHARE with friends and FOLLOW me @kalejunkie for more fun recipes!⁣ ⁣ Comment LINK and I will DM you my ice cube trays—they are super sturdy and have covers so you can stack them easily! 12/10 recommend!⁣ ⁣ Cookie dough layer⁣ 1 3/4 cups almond flour⁣ 1/4 cup maple syrup⁣ 1/4 cup coconut oil, melted and cooled⁣ 2 tsp vanilla extract⁣ 1 cup crushed peanut butter cups (I used the dark chocolate PB cups from Trader Joe's)⁣ ⁣ 1 cup mini marshmallows of choice (I used @mydandies vegan marshmallows)⁣ ⁣ Chocolate base/top⁣ 1 cup mini chocolate chips (I used @enjoylifefoods)⁣ 2 tsp coconut oil⁣ ⁣ First make the cookie dough. In a bowl, mix together the almond flour, maple syrup, coconut oil and vanilla extract. Chop the peanut butter cups and fold them in. Set aside. Next, make the chocolate layer. Add chocolate chips and coconut oil to a bowl and microwave in 2-3, 30-second increments until melted and smooth. Pour a tiny amount into each ice cube cavity (~1/2 tsp). Freeze the tray for 5 minutes. Remove tray from freezer. Fill each cavity 3/4 way with cookie dough, pressing it down firmly. Then add 3-4 mini marshmallows on top, followed by remaining chocolate. Freeze for 2 hours and enjoy. I like storing these in the freezer because they defrost quickly! ENJOY!\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "PB Cookie Dough S'mores Bites",
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 1.75, unit: "cup", item: "almond flour", section: "Cookie dough layer" },
        { amount: 0.25, unit: "cup", item: "maple syrup", section: "Cookie dough layer" },
        { amount: 0.25, unit: "cup", item: "coconut oil", section: "Cookie dough layer" },
        { amount: 2, unit: "tsp", item: "vanilla extract", section: "Cookie dough layer" },
        { amount: 1, unit: "cup", item: "crushed peanut butter cups", section: "Cookie dough layer" },
        { amount: 1, unit: "cup", item: "mini marshmallows of choice", section: "Cookie dough layer" },
        { amount: 1, unit: "cup", item: "mini chocolate chips", section: "Chocolate base/top" },
        { amount: 2, unit: "tsp", item: "coconut oil", section: "Chocolate base/top" },
      ],
    },
  },
};

export const caption_street_corn_beef_bowls: Fixture = {
  id: "caption-street-corn-beef-bowls",
  input: {
    kind: "caption",
    text: "A recipe worth trying for sure!! It's delicious 🤤 Save this recipe for later & lemme know if you try it! Ingredients: - 2 lbs ground beef (90/10 or leaner) - 2 pkg taco seasoning\n4 sweet potatoes - 2-3 tbsp avocado oil - 2-3 tbsp kinders the blend seasoning - 1-2 tbsp cumin\n1 bag roasted corn - 1/4 cup plain greek yogurt - 1-2 tbsp of mayo - juice from 1/2 lime - 1-2 tbsp elote seasoning - 1/4 cup cotija cheese - 1-2 tbsp fresh cilantro chopped\n1 avocado for topping - 1/4 cup cotija cheese for topping - fresh cilantro for garnish I don't really measure seasonings when I'm cooking, I just go by how it tastes and add more as I need! Directions:\nStart by chopping your sweet potatoes and seasoning them with avocado oil, kinders the blend & cumin — put onto a parchment lined pan & bake at 425 for 35-45 min (until fork tender and a lil crispy) I swear sometimes it takes even longer\nCook up your ground beef and season with taco seasoning, once cooked set aside on low heat.\nMake your street corn by combining the roasted corn, Greek yogurt, mayo, lime juice, elote seasoning, cotija cheese & cilantro\nAssemble the bowls: baked sweet potatoes, ground beef, street corn, fresh avocado, cotija & cilantro. I could eat this every day! 10/10 no notes 🤌🏼 This would make a great meal prep recipe too! #viralrecipes #highprotein #highproteindinners #highproteinrecipe #streetcornbowls See less\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: null,
      servings: null,
      totalMinutes: null,
      ingredients: [
        { amount: 2, unit: "lb", item: "ground beef" },
        { amount: 2, unit: null, item: "pkg taco seasoning" },
        { amount: 4, unit: null, item: "sweet potatoes" },
        { amount: 3, unit: "tbsp", item: "avocado oil" },
        { amount: 3, unit: "tbsp", item: "kinders the blend seasoning" },
        { amount: 2, unit: "tbsp", item: "cumin" },
        { amount: 1, unit: null, item: "bag roasted corn" },
        { amount: 0.25, unit: "cup", item: "plain greek yogurt" },
        { amount: 2, unit: "tbsp", item: "mayo" },
        { amount: 0.5, unit: null, item: "lime" },
        { amount: 2, unit: "tbsp", item: "elote seasoning" },
        { amount: 0.25, unit: "cup", item: "cotija cheese" },
        { amount: 2, unit: "tbsp", item: "fresh cilantro" },
        { amount: 1, unit: null, item: "avocado" },
        { amount: 0.25, unit: "cup", item: "cotija cheese" },
        { amount: null, unit: null, item: "fresh cilantro" },
      ],
    },
  },
};

export const caption_sweet_chilli_crispy_rice_salad: Fixture = {
  id: "caption-sweet-chilli-crispy-rice-salad",
  input: {
    kind: "caption",
    text: "my viral sweet chilli crispy rice salad because I still get a DM almost every day asking where to find the recipe. This salad has reached over 40 million people and it is probably one of my favourite recipes I've ever made. If you still haven't tried it, let this be your sign. Recipe below 🫶 Serves 4 large bowls Crispy Rice: 450g cooked jasmine rice, cooled 3 tsp soy sauce 1 tbsp chilli crisp oil 1 tbsp sesame oil Salad: 1 to 2 large cucumbers, thinly sliced 1 cup edamame 1 bunch green onions, thinly sliced 1 avocado, chopped Cooked crispy chicken or grilled chicken (I love Fropro protein healthy fried chicken) Chopped peanuts, optional Sweet Chilli Creamy Dressing: ¼ cup Greek yoghurt ¼ cup mayo, I used light 50ml sweet chilli sauce ½ tsp paprika Water to thin Method: Preheat oven to 200°C and line a tray with baking paper. Toss the cooled rice with soy sauce, chilli crisp and sesame oil until coated. Spread evenly on the tray and bake for 30 to 40 minutes, tossing halfway, until golden and crispy. Cook your chicken as instructed. Add cucumber, edamame, green onion, avocado, cooked chicken and crispy rice to a large bowl. Whisk the dressing ingredients until smooth, using water to thin if needed. Taste and adjust. Pour over the salad, toss gently, garnish with sesame seeds or peanuts and enjoy. Macros per serve, approx: 520 cals, 33g protein #crispyricesalad\n",
  },
  expected: {
    outcome: "recipe",
    recipe: {
      title: "Sweet Chilli Crispy Rice Salad",
      servings: 4,
      totalMinutes: null,
      ingredients: [
        { amount: 450, unit: "g", item: "cooked jasmine rice", section: "Crispy Rice" },
        { amount: 3, unit: "tsp", item: "soy sauce", section: "Crispy Rice" },
        { amount: 1, unit: "tbsp", item: "chilli crisp oil", section: "Crispy Rice" },
        { amount: 1, unit: "tbsp", item: "sesame oil", section: "Crispy Rice" },
        { amount: 2, unit: null, item: "large cucumbers", section: "Salad" },
        { amount: 1, unit: "cup", item: "edamame", section: "Salad" },
        { amount: 1, unit: "bunch", item: "green onions", section: "Salad" },
        { amount: 1, unit: null, item: "avocado", section: "Salad" },
        { amount: null, unit: null, item: "Cooked crispy chicken or grilled chicken", section: "Salad" },
        { amount: null, unit: null, item: "Chopped peanuts", section: "Salad" },
        { amount: 0.25, unit: "cup", item: "Greek yoghurt", section: "Sweet Chilli Creamy Dressing" },
        { amount: 0.25, unit: "cup", item: "mayo", section: "Sweet Chilli Creamy Dressing" },
        { amount: 50, unit: "ml", item: "sweet chilli sauce", section: "Sweet Chilli Creamy Dressing" },
        { amount: 0.5, unit: "tsp", item: "paprika", section: "Sweet Chilli Creamy Dressing" },
        { amount: null, unit: null, item: "Water to thin", section: "Sweet Chilli Creamy Dressing" },
      ],
    },
  },
};
